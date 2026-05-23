TNT you can prime and punch, gamepad play from menus through mining, glass back-walls that let daylight in, and fixes for torch glow, WebGPU chunk teardown, and main-menu room refresh.

+ Added TNT — place the block, then use it to prime a ~4 second fuse; the primed block falls, drifts in water, and can be punched for knockback.
+ TNT explosions break foreground blocks in a short radius, scale loot drops by block hardness, and hurt players and mobs with falloff by distance.
+ Multiplayer syncs primed TNT spawn, motion, despawn, and punch knockback for everyone in the session.
+ Gamepad support: move, jump, sprint, inventory, chat, place/break on triggers, hotbar on bumpers/D-pad, and right-stick aim in-world.
+ Main menu, pause, death, and inventory use gamepad focus navigation; inventory adds a virtual cursor (A pick/swap, RT slot action).
+ Pause menu adds a fullscreen toggle for couch and TV browsers.
* Glass or empty back-wall tiles behind solid foreground now pass skylight like windows.
* Adjusted torch bloom gradient and flame anchor so underglow lines up with the sprite and avoids dark halos on sky and clouds.
* Firefly lights pick emitters nearest you or other players in view, not only the camera center.
* Softened main-menu cloud strip edges so tiled clouds band and speckle less on bright sky.
- Fixed WebGPU crashes from destroying chunk GPU buffers in the same turn as submit; teardown waits until the next frame.
- Fixed background music sometimes never starting when the browser blocks autoplay until you interact.
- Main menu online room list auto-refresh drops closed rooms without flashing skeleton loaders; room detail warns when the host is gone.
- Sign-up and password-reset emails redirect back to the game’s deployed path instead of the site root.
* Skin & Beauty “none” swatches for nametag and outline use a clear off icon instead of text.
- Crash reports sent to Discord strip bad control characters and keep stack trace fields when the embed is trimmed.
- Production build copies index.html to 404.html so deep links work on GitHub Pages.
