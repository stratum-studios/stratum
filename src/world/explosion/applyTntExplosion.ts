/**
 * Host-authoritative TNT blast: foreground cells only, Minecraft-ish radius, explosion-decay drops.
 */
import {
  BLOCK_SIZE,
  PRIMED_TNT_EXPLOSION_RADIUS_BLOCKS,
  TNT_EXPLOSION_DROP_HARDNESS_K,
  TNT_EXPLOSION_ENTITY_DAMAGE_MAX,
  PLAYER_HEIGHT,
} from "../../core/constants";
import type { WorldGameMode } from "../../core/types";
import type { GeneratorContext } from "../gen/GeneratorContext";
import type { BlockRegistry } from "../blocks/BlockRegistry";
import type { World } from "../World";
import { applyExplosionForegroundBreak } from "../terrain/applyCommittedBreak";
import type { MobManager } from "../../entities/mobs/MobManager";
import type { PrimedTnt } from "../../entities/PrimedTnt";
import { mobHitboxSizePx } from "../../entities/mobs/mobConstants";
import type { PeerId } from "../../network/INetworkAdapter";
import type { TerrariaMobStrike } from "../../entities/mobs/terrariaKnockback";

export type TntExplosionHostContext = {
  world: World;
  registry: BlockRegistry;
  gameMode: WorldGameMode;
  rng: GeneratorContext;
  localPlayerFeet: { x: number; y: number };
  remotePlayers: ReadonlyMap<string, { getAuthorityFeet(): { x: number; y: number } }>;
  mobManager: MobManager | null;
  damageLocalPlayer: (amount: number) => void;
  damageRemotePlayerByPeerId: (peerId: PeerId, damage: number) => void;
};

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function explosionDamageAtDistance(distBlocks: number): number {
  const R = PRIMED_TNT_EXPLOSION_RADIUS_BLOCKS + 2;
  if (distBlocks > R) {
    return 0;
  }
  const t = 1 - distBlocks / (R + 1);
  return Math.max(0, Math.floor(TNT_EXPLOSION_ENTITY_DAMAGE_MAX * t * t));
}

export function applyTntExplosionFromPrimed(
  tnt: PrimedTnt,
  ctx: TntExplosionHostContext,
): void {
  const cx = Math.floor(tnt.x / BLOCK_SIZE);
  const cy = Math.floor(tnt.y / BLOCK_SIZE);
  applyTntExplosionAtCell(cx, cy, ctx);
}

export function applyTntExplosionAtCell(
  centerWx: number,
  centerWy: number,
  ctx: TntExplosionHostContext,
): void {
  const { world, registry, gameMode, rng } = ctx;
  const airId = world.getAirBlockId();
  const R = PRIMED_TNT_EXPLOSION_RADIUS_BLOCKS;

  world.pushBulkForegroundWrites();
  try {
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (chebyshev(dx, dy, 0, 0) > R) {
          continue;
        }
        const wx = centerWx + dx;
        const wy = centerWy + dy;
        const cell = world.getBlock(wx, wy);
        if (cell.id === airId || cell.water) {
          continue;
        }
        if (cell.hardness >= 999) {
          continue;
        }
        const hardness = Math.max(0, cell.hardness);
        const dropRoll =
          rng.nextFloat() < 1 / (1 + TNT_EXPLOSION_DROP_HARDNESS_K * hardness);
        applyExplosionForegroundBreak(world, registry, wx, wy, airId, gameMode, dropRoll);
      }
    }
  } finally {
    world.popBulkForegroundWrites();
  }

  const cxPx = (centerWx + 0.5) * BLOCK_SIZE;
  const cyPx = (centerWy + 0.5) * BLOCK_SIZE;
  applyEntityDamage(cxPx, cyPx, ctx);
}

function applyEntityDamage(
  blastCX: number,
  blastCY: number,
  ctx: TntExplosionHostContext,
): void {
  const { localPlayerFeet, remotePlayers, mobManager, rng } = ctx;

  const plCx = localPlayerFeet.x;
  const plCy = localPlayerFeet.y + PLAYER_HEIGHT * 0.5;
  const distPl =
    Math.hypot(plCx - blastCX, plCy - blastCY) / BLOCK_SIZE;
  const dmgLocal = explosionDamageAtDistance(distPl);
  if (dmgLocal > 0) {
    ctx.damageLocalPlayer(dmgLocal);
  }

  for (const [peerId, rp] of remotePlayers) {
    const f = rp.getAuthorityFeet();
    const pcx = f.x;
    const pcy = f.y + PLAYER_HEIGHT * 0.5;
    const dist =
      Math.hypot(pcx - blastCX, pcy - blastCY) / BLOCK_SIZE;
    const dmg = explosionDamageAtDistance(dist);
    if (dmg > 0) {
      ctx.damageRemotePlayerByPeerId(peerId as PeerId, dmg);
    }
  }

  if (mobManager === null) {
    return;
  }

  for (const m of mobManager.getAll()) {
    const { h: hh } = mobHitboxSizePx(m.kind);
    const mcx = m.x;
    const mcy = m.y + hh * 0.5;
    const dist = Math.hypot(mcx - blastCX, mcy - blastCY) / BLOCK_SIZE;
    const dmg = explosionDamageAtDistance(dist);
    if (dmg <= 0) {
      continue;
    }
    const knockDir: 1 | -1 = m.x >= blastCX ? 1 : -1;
    const strike: TerrariaMobStrike = {
      style: "projectile",
      baseKnockback: 6,
      knockDir,
    };
    mobManager.damageMobFromHost(m.id, rng, blastCX, dmg, strike, {
      emitDamageFx: true,
    });
  }
}
