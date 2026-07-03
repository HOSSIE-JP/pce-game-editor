/* pce_vn_runtime.c — CD-ROM2 VN runtime umbrella (Phase A module split).
   The build still compiles src/main.c only (unity build; see
   pce-build-system.js collectSourceFiles), so this file #includes every module
   in dependency order. The module bodies were moved verbatim out of the old
   single-file runtime; besides these #include lines the only additions are the
   forward declarations and re-opened #if defined(__PCE_CD__) guards marked
   with PHASE_A_SPLIT comments inside the modules.

   Include order (dependency-driven):
   - vn_engine_config.h first: every #define / section macro / MMIO address.
   - vn_engine_state.c: global state, shared typedefs, forward declarations.
   - vn_engine_time.c before vn_engine_bus.c: cd_transfer_wait (bus) expands
     the VN_ADD_ESTIMATED_FRAME macro defined with the TIMER driver in time.
   - vn_engine_bus.c before all CD/BIOS users: it defines the pce_cdb_*
     interception wrappers, MPR slot helpers and overlay dispatch.
   - vn_port_video.c before the cores: VRAM copy helpers, palette/fade and the
     SNAPSHOT_DATA_REF macro used by sprite/cache code.
   - vn_cache_core.c before psg/adpcm/cdda: VN_META_* record layout macros and
     the vn_get_* metadata accessors.
   - vn_port_sprite.c before vn_msg_core.c (start_message calls
     cache_sprite_animation); vn_msg_core.c before vn_port_scene.c
     (execute_command/start_choice call into the message window helpers);
     vn_main.c last. */
#include "vn_engine_config.h"
#include "vn_engine_state.c"
#include "vn_engine_time.c"
#include "vn_engine_bus.c"
#include "vn_port_video.c"
#include "vn_cache_core.c"
#include "vn_psg_core.c"
#include "vn_adpcm_core.c"
#include "vn_port_cdda.c"
#include "vn_port_sprite.c"
#include "vn_msg_core.c"
#include "vn_port_scene.c"
#include "vn_main.c"
