/* IRQ epoch based frame service.
   PSG timing is owned entirely by System Card PSG_DRIVE in the VSync IRQ.
   The main thread consumes the same monotonic epoch only for ADPCM countdown
   and other cooperative per-frame work; it never polls VDC status or owns the
   HuC6280 TIMER. */

static uint16_t vn_service_epoch __attribute__((section(".bss")));

static void VN_RESIDENT_CODE service_adpcm_during_blocking_frames(uint8_t frames, uint8_t restore_visual_cache)
{
#if defined(__PCE_CD__)
    if (!frames || !adpcm_play_active) return;
    while (frames--)
    {
        (void)vn_cd_async_call_bank122(VN_CD_ASYNC_OP_ADPCM_PLAYBACK);
    }
    (void)restore_visual_cache;
#else
    (void)frames;
    (void)restore_visual_cache;
#endif
}

static uint8_t VN_RESIDENT_CODE vn_consume_frame_epoch(void)
{
    uint16_t current;
    uint16_t delta;
    uint8_t frames;
    __asm__ volatile("php\n\tsei" ::: "memory");
    current = vn_frame_epoch;
    __asm__ volatile("plp" ::: "p", "memory");
    delta = (uint16_t)(current - vn_service_epoch);
    if (!delta) return 0u;
    frames = delta > 255u ? 255u : (uint8_t)delta;
    vn_service_epoch = (uint16_t)(vn_service_epoch + frames);
    return frames;
}

static void VN_RESIDENT_CODE engine_service(void)
{
    const uint8_t frames = vn_consume_frame_epoch();
    service_adpcm_during_blocking_frames(frames, 0u);
}

static void VN_RESIDENT_CODE engine_service_blocking(uint16_t iterations)
{
    /* Blocking BIOS/direct-SCSI work no longer synthesizes audio credit.
       VSync IRQs continue to drive PSG and advance the epoch while this code
       runs; consume only epochs that actually occurred. */
    (void)iterations;
    engine_service();
}

static uint8_t VN_BANKED_CODE2 init_psg_service(void)
{
#if defined(__PCE_CD__)
    uint8_t ready;
    vn_service_epoch = vn_frame_epoch;
    ready = vn_system_card_init_psg();
    vn_service_epoch = vn_frame_epoch;
    return ready;
#else
    return 1u;
#endif
}
