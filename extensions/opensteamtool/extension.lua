-- ============================================================================
-- Install
-- ============================================================================

--- Install OpenSteamTool or recover an existing disabled installation.
---
--- Recovery behavior:
--- - If all managed DLLs are active, no download is needed.
--- - If all managed DLLs exist as .bak, restore them and do not download.
--- - If config/lua.bak exists while config/lua does not, restore it.
--- - If neither config/lua nor config/lua.bak exists, create only config/lua.
--- - Download the release only when no complete active or disabled
---   installation can be recovered.
local function install(steam_root)
  log(
    "INFO",
    "install(steam_root=" ..
    tostring(steam_root) ..
    ")"
  )

  if (
    steam_root == nil or
    steam_root == ""
  ) then
    error(
      "Steam root directory not provided"
    )
  end

  local current =
    detect(steam_root)

  -- ==========================================================
  -- Case 1: already installed and enabled
  -- ==========================================================

  if (
    #current.installedFiles ==
      #MANAGED_DLLS
  ) then
    log(
      "INFO",
      "All managed DLLs are already active; download skipped"
    )

    local lua_dir =
      lua_folder(steam_root)

    local lua_bak =
      lua_backup(steam_root)

    if exists(lua_dir) then
      log(
        "INFO",
        "config/lua already exists; preserving contents"
      )
    elseif exists(lua_bak) then
      rename(
        lua_bak,
        lua_dir
      )

      log(
        "INFO",
        "Restored config/lua from legacy lua.bak"
      )
    else
      lumaforge.create_dir(
        lua_dir
      )

      if not exists(lua_dir) then
        error(
          "Failed to create config/lua directory: " ..
          lua_dir
        )
      end

      log(
        "INFO",
        "Created missing config/lua directory"
      )
    end

    return {
      success = true,
      status = "enabled",
      recovered = false,
      downloaded = false
    }
  end

  -- ==========================================================
  -- Case 2: already installed but disabled
  -- All three DLLs exist as .bak, so restore instead of download.
  -- ==========================================================

  if (
    #current.backupFiles ==
      #MANAGED_DLLS and
    #current.installedFiles == 0
  ) then
    log(
      "INFO",
      "Complete disabled installation detected; restoring DLL backups"
    )

    for _, dll in ipairs(
      MANAGED_DLLS
    ) do
      local dll_path =
        steam_root ..
        "\\" ..
        dll

      local bak_path =
        dll_path ..
        ".bak"

      if not exists(bak_path) then
        error(
          "Cannot recover installation; backup is missing: " ..
          bak_path
        )
      end

      if exists(dll_path) then
        remove(
          dll_path
        )
      end

      rename(
        bak_path,
        dll_path
      )

      if not exists(dll_path) then
        error(
          "Failed to restore managed DLL: " ..
          dll
        )
      end

      log(
        "INFO",
        "Restored " ..
        dll ..
        ".bak -> " ..
        dll
      )
    end

    -- Restore the old shared Lua backup only when the active
    -- lua directory does not already exist.
    local lua_dir =
      lua_folder(steam_root)

    local lua_bak =
      lua_backup(steam_root)

    if exists(lua_dir) then
      log(
        "INFO",
        "config/lua already exists; preserving contents"
      )

      if exists(lua_bak) then
        log(
          "WARN",
          "Both config/lua and config/lua.bak exist; preserving both"
        )
      end
    elseif exists(lua_bak) then
      rename(
        lua_bak,
        lua_dir
      )

      if not exists(lua_dir) then
        error(
          "Failed to restore config/lua from lua.bak"
        )
      end

      log(
        "INFO",
        "Restored config/lua.bak -> config/lua"
      )
    else
      lumaforge.create_dir(
        lua_dir
      )

      if not exists(lua_dir) then
        error(
          "Failed to create config/lua directory: " ..
          lua_dir
        )
      end

      log(
        "INFO",
        "Created missing config/lua directory"
      )
    end

    -- Verify that every DLL is active and that no managed
    -- backup remains after recovery.
    for _, dll in ipairs(
      MANAGED_DLLS
    ) do
      local dll_path =
        steam_root ..
        "\\" ..
        dll

      local bak_path =
        dll_path ..
        ".bak"

      if not exists(dll_path) then
        error(
          "Recovery verification failed; active DLL missing: " ..
          dll
        )
      end

      if exists(bak_path) then
        error(
          "Recovery verification failed; backup still exists: " ..
          dll ..
          ".bak"
        )
      end
    end

    log(
      "INFO",
      "Disabled installation recovered successfully; download skipped"
    )

    return {
      success = true,
      status = "enabled",
      recovered = true,
      downloaded = false
    }
  end

  -- ==========================================================
  -- Case 3: partially disabled installation
  -- Restore any available backups before deciding to download.
  -- ==========================================================

  if #current.backupFiles > 0 then
    log(
      "INFO",
      "Partial backup state detected; restoring available DLL backups"
    )

    for _, dll in ipairs(
      MANAGED_DLLS
    ) do
      local dll_path =
        steam_root ..
        "\\" ..
        dll

      local bak_path =
        dll_path ..
        ".bak"

      if (
        not exists(dll_path) and
        exists(bak_path)
      ) then
        rename(
          bak_path,
          dll_path
        )

        log(
          "INFO",
          "Restored available backup for " ..
          dll
        )
      end
    end

    local recovered_state =
      detect(steam_root)

    if (
      #recovered_state.installedFiles ==
        #MANAGED_DLLS
    ) then
      local lua_dir =
        lua_folder(steam_root)

      local lua_bak =
        lua_backup(steam_root)

      if not exists(lua_dir) then
        if exists(lua_bak) then
          rename(
            lua_bak,
            lua_dir
          )

          log(
            "INFO",
            "Restored config/lua.bak -> config/lua"
          )
        else
          lumaforge.create_dir(
            lua_dir
          )

          if not exists(lua_dir) then
            error(
              "Failed to create config/lua directory: " ..
              lua_dir
            )
          end
        end
      end

      log(
        "INFO",
        "Partial installation recovered completely; download skipped"
      )

      return {
        success = true,
        status = "enabled",
        recovered = true,
        downloaded = false
      }
    end

    log(
      "WARN",
      "Backup recovery was incomplete; missing DLLs will be downloaded"
    )
  end

  -- ==========================================================
  -- Case 4: no recoverable installation, download the release
  -- ==========================================================

  local ext_dir =
    lumaforge.get_extension_dir(
      "opensteamtool-repo"
    )

  if (
    ext_dir == nil or
    ext_dir == ""
  ) then
    error(
      "Failed to resolve OpenSteamTool extension directory"
    )
  end

  local download_url,
    tag_name =
      fetch_latest_release()

  local safe_tag =
    tag_name:gsub(
      "[^%w%.%-_]",
      "_"
    )

  local zip_path =
    temp_path(
      ext_dir,
      "opensteamtool-" ..
      safe_tag ..
      ".zip"
    )

  log(
    "INFO",
    "Downloading " ..
    download_url ..
    " -> " ..
    zip_path
  )

  lumaforge.download_file(
    download_url,
    zip_path
  )

  if not exists(zip_path) then
    error(
      "Downloaded ZIP does not exist: " ..
      zip_path
    )
  end

  local extract_dir =
    temp_path(
      ext_dir,
      "extracted-" ..
      safe_tag
    )

  lumaforge.create_dir(
    extract_dir
  )

  log(
    "INFO",
    "Extracting to " ..
    extract_dir
  )

  local extracted =
    lumaforge.extract_zip(
      zip_path,
      extract_dir,
      MANAGED_DLLS
    )

  if (
    extracted == nil or
    #extracted == 0
  ) then
    error(
      "No managed DLLs found in the downloaded archive"
    )
  end

  log(
    "INFO",
    "Extracted " ..
    #extracted ..
    " files: " ..
    table.concat(
      extracted,
      ", "
    )
  )

  -- Require all three files before changing Steam Root.
  for _, dll in ipairs(
    MANAGED_DLLS
  ) do
    local source_path =
      extract_dir ..
      "\\" ..
      dll

    if not exists(source_path) then
      error(
        "Required managed DLL was not extracted: " ..
        dll
      )
    end
  end

  for _, dll in ipairs(
    MANAGED_DLLS
  ) do
    local source_path =
      extract_dir ..
      "\\" ..
      dll

    local destination_path =
      steam_root ..
      "\\" ..
      dll

    local backup_path =
      destination_path ..
      ".bak"

    -- A stale backup from a disabled or partial state should
    -- be restored rather than replaced by a new download.
    if (
      not exists(destination_path) and
      exists(backup_path)
    ) then
      rename(
        backup_path,
        destination_path
      )

      log(
        "INFO",
        "Restored existing backup instead of replacing " ..
        dll
      )
    else
      if exists(destination_path) then
        remove(
          destination_path
        )
      end

      rename(
        source_path,
        destination_path
      )

      log(
        "INFO",
        "Placed " ..
        dll ..
        " into Steam root"
      )
    end

    if not exists(destination_path) then
      error(
        "Installation verification failed for " ..
        dll
      )
    end
  end

  -- Handle config/lua safely.
  local lua_dir =
    lua_folder(steam_root)

  local lua_bak =
    lua_backup(steam_root)

  if exists(lua_dir) then
    log(
      "INFO",
      "config/lua already exists; preserving contents"
    )
  elseif exists(lua_bak) then
    rename(
      lua_bak,
      lua_dir
    )

    if not exists(lua_dir) then
      error(
        "Failed to restore config/lua from lua.bak"
      )
    end

    log(
      "INFO",
      "Restored config/lua.bak -> config/lua"
    )
  else
    lumaforge.create_dir(
      lua_dir
    )

    if not exists(lua_dir) then
      error(
        "Failed to create config/lua directory: " ..
        lua_dir
      )
    end

    log(
      "INFO",
      "Created missing config/lua directory"
    )
  end

  -- Final verification.
  for _, dll in ipairs(
    MANAGED_DLLS
  ) do
    local dll_path =
      steam_root ..
      "\\" ..
      dll

    if not exists(dll_path) then
      error(
        "Final installation verification failed: " ..
        dll ..
        " is missing"
      )
    end
  end

  log(
    "DEBUG",
    "Cleaning up temporary files"
  )

  pcall(function()
    remove(
      zip_path
    )
  end)

  for _, file_name in ipairs(
    extracted
  ) do
    pcall(function()
      local extracted_file =
        extract_dir ..
        "\\" ..
        file_name

      if exists(extracted_file) then
        remove(
          extracted_file
        )
      end
    end)
  end

  log(
    "INFO",
    "Install complete"
  )

  return {
    success = true,
    status = "enabled",
    recovered = false,
    downloaded = true,
    version = tag_name
  }
end

-- ============================================================================
-- Extension Contract
-- ============================================================================

extension = {
  -- Metadata (captured by load_and_evaluate into LuaExtensionTable)
  id          = "opensteamtool-repo",
  name        = "OpenSteamTool (Community)",
  version     = "1.4.8",
  description = "DLL-based Steam integration tool (independent Lua module)",

  -- Lifecycle handlers (called by call_extension_* commands)
  detect      = detect,
  install     = install,
  enable      = enable,
  disable     = disable,
  uninstall   = uninstall
}
