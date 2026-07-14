/* System Card PSG package runtime.
   CD builds never interpret editor tracker rows on the HuC6280. The generator
   compiles each referenced (assetId, channel) variant to Hu7 track bytecode;
   this module only loads the selected package and controls the independent
   main/sub buses through vn_system_card.c. */

#if defined(__PCE_CD__)
#define VN_SYSTEM_PSG_BGM_BUS 0u
#define VN_SYSTEM_PSG_SFX_BUS 1u
#define VN_SYSTEM_PSG_BGM_ADDR 0xc024u
#define VN_SYSTEM_PSG_SFX_ADDR 0xc000u
#define VN_SYSTEM_PSG_BGM_LIMIT 8156u
#define VN_SYSTEM_PSG_SFX_LIMIT 8192u

static void VN_BANKED_CODE2 vn_system_psg_update_active(void)
{
    psg_active = (uint8_t)(system_psg_bus_active[0] || system_psg_bus_active[1]);
}

static void VN_BANKED_CODE2 vn_system_psg_stop_bus(uint8_t bus)
{
    uint8_t guard = 255u;
    if (bus > VN_SYSTEM_PSG_SFX_BUS) return;
    vn_system_card_psg_stop_bus(bus);
    while (guard-- && vn_system_card_psg_status_bus(bus)) {}
    system_psg_bus_active[bus] = 0u;
    vn_system_psg_update_active();
}

static void VN_BANKED_CODE2 stop_psg_target(uint8_t target)
{
    if (target == PCE_VN_PSG_STOP_BGM)
    {
        vn_system_psg_stop_bus(VN_SYSTEM_PSG_BGM_BUS);
    }
    else if (target == PCE_VN_PSG_STOP_SFX)
    {
        vn_system_psg_stop_bus(VN_SYSTEM_PSG_SFX_BUS);
    }
    else
    {
        vn_system_card_psg_stop_all();
        system_psg_bus_active[0] = 0u;
        system_psg_bus_active[1] = 0u;
        vn_system_psg_update_active();
    }
}

static void VN_BANKED_CODE2 stop_psg(void)
{
    stop_psg_target(PCE_VN_PSG_STOP_ALL);
}

static uint8_t VN_BANKED_CODE2 vn_system_psg_package_snapshot(uint16_t index,
    pce_vn_system_psg_package_t *package)
{
    map_vn_data();
    if (index >= pce_vn_system_psg_package_count)
    {
        map_resident_data();
        return 0u;
    }
    *package = pce_vn_system_psg_packages[index];
    map_resident_data();
    if (package->bus > VN_SYSTEM_PSG_SFX_BUS || !package->data.byte_size ||
        !package->data.sector_count) return 0u;
    if (package->bus == VN_SYSTEM_PSG_BGM_BUS)
        return (uint8_t)(package->data.byte_size <= VN_SYSTEM_PSG_BGM_LIMIT);
    return (uint8_t)(package->data.byte_size <= VN_SYSTEM_PSG_SFX_LIMIT);
}

static uint8_t VN_BANKED_CODE2 vn_system_psg_load_package(uint16_t index, uint8_t play_after)
{
    pce_vn_system_psg_package_t package;
    pce_sector_t sector;
    uint8_t bus;
    uint8_t dest_bank;
    uint16_t dest_addr;
    const uint16_t key = (uint16_t)(index + 1u);
    if (!vn_system_psg_package_snapshot(index, &package)) return 0u;
    bus = package.bus;
    if (loaded_system_psg_package_key[bus] != key)
    {
        vn_system_psg_stop_bus(bus);
        sector.lo = package.data.sector.lo;
        sector.md = package.data.sector.md;
        sector.hi = package.data.sector.hi;
        dest_bank = bus ? 135u : 134u;
        dest_addr = bus ? VN_SYSTEM_PSG_SFX_ADDR : VN_SYSTEM_PSG_BGM_ADDR;
        loaded_system_psg_package_key[bus] = 0u;
        if (!vn_cd_async_begin_data_read(sector, VN_CD_ASYNC_DEST_PSG_BANK,
                dest_bank, dest_addr, package.data.byte_size)) return 0u;
        while (!vn_cd_async_done())
        {
            vn_wait_next_vblank_raw();
            engine_service();
            vn_cd_async_service_frame();
        }
        if (!vn_cd_async_succeeded()) return 0u;
        loaded_system_psg_package_key[bus] = key;
    }
    if (play_after)
    {
        vn_system_card_psg_play_bus(bus);
        system_psg_bus_active[bus] = 1u;
        vn_system_psg_update_active();
    }
    return 1u;
}

static void VN_BANKED_CODE2 play_psg_asset(signed int asset_index, uint8_t unused_channel)
{
    (void)unused_channel;
    if (asset_index < 0) return;
    (void)vn_system_psg_load_package((uint16_t)asset_index, 1u);
}

static uint8_t VN_BANKED_CODE2 load_psg_cache_asset(signed int asset_index)
{
    if (asset_index < 0) return 0u;
    return vn_system_psg_load_package((uint16_t)asset_index, 0u);
}

#endif
