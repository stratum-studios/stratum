/**
 * Primed TNT: gravity block entity with fuse timer (world-center position, Y-up feet space).
 */
import {
  BLOCK_SIZE,
  ITEM_DROP_LANDING_FRICTION,
  ITEM_GRAVITY,
  ITEM_MAX_FALL_SPEED,
  PRIMED_TNT_HALF_EXTENT_PX,
} from "../core/constants";
import type { WorldCollisionReader } from "../core/worldCollision";
import { createAABB, sweepAABB, type AABB } from "./physics/AABB";

const h = PRIMED_TNT_HALF_EXTENT_PX;

function centerToScreenAABB(ix: number, iy: number): AABB {
  return createAABB(ix - h, -(iy + h), h * 2, h * 2);
}

function screenAABBToworldCenter(m: AABB): { x: number; y: number } {
  return {
    x: m.x + h,
    y: -m.y - h,
  };
}

export class PrimedTnt {
  readonly id: string;
  /** World horizontal center (px), +right. */
  x: number;
  /** World vertical center (px), +up. */
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  fuseRemainSec: number;
  /** Host net id when replicated (`n` + number). */
  readonly netId: number | null;

  constructor(
    id: string,
    x: number,
    y: number,
    vx: number,
    vy: number,
    fuseRemainSec: number,
    netId: number | null = null,
  ) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.vx = vx;
    this.vy = vy;
    this.fuseRemainSec = fuseRemainSec;
    this.netId = netId;
  }

  /**
   * Integrate velocity and collision for one tick.
   */
  tick(dt: number, world: WorldCollisionReader, solidScratch: AABB[]): void {
    this.prevX = this.x;
    this.prevY = this.y;

    const g = ITEM_GRAVITY * BLOCK_SIZE;
    this.vy += g * dt;
    const vmax = ITEM_MAX_FALL_SPEED * BLOCK_SIZE;
    if (this.vy > vmax) {
      this.vy = vmax;
    }

    const pad = 2;
    const screenDx = this.vx * dt;
    const screenDy = this.vy * dt;
    let mover = centerToScreenAABB(this.x, this.y);
    const query = createAABB(
      Math.min(mover.x, mover.x + screenDx) - pad,
      Math.min(mover.y, mover.y + screenDy) - pad,
      Math.abs(screenDx) + mover.width + pad * 2,
      Math.abs(screenDy) + mover.height + pad * 2,
    );
    world.querySolidAABBs(query, solidScratch);
    const { hitX, hitY } = sweepAABB(mover, screenDx, screenDy, solidScratch);
    const c = screenAABBToworldCenter(mover);
    this.x = c.x;
    this.y = c.y;
    if (hitX) {
      this.vx = 0;
    }
    if (hitY) {
      this.vy = 0;
      if (screenDy > 0) {
        this.vx *= ITEM_DROP_LANDING_FRICTION;
      }
    }

    this.fuseRemainSec -= dt;
  }

  /** Block column indices containing this entity’s center. */
  centerBlockCell(): { wx: number; wy: number } {
    return {
      wx: Math.floor(this.x / BLOCK_SIZE),
      wy: Math.floor(this.y / BLOCK_SIZE),
    };
  }
}
