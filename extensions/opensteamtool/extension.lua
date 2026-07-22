--[[
  OpenSteamTool — Independent Lua Extension

  All lifecycle functions run inside the mlua sandbox with access to
  the lumaforge.* API. Every file operation uses the Rust backend.

  Shared-directory safety contract:
  - Steam/config must already exist.
  - OpenSteamTool may create only Steam/config/lua when missing.
  - If legacy Steam/config/lua.bak exists and lua does not, restore it.
  - Disable and uninstall never move, delete, rename, or clear config/lua.
  - Only the managed DLL files use the .bak enable/disable lifecycle.
]]

-- ============================================================================
-- Constants
-- ============================================================================

local EXTENSION_ID = "opensteamtool"

local MANAGED_DLLS = {
  "dwmapi.dll",
  "xinput1_4.dll",
  "OpenSteamTool.dll"
}

local GITHUB_OWNER = "OpenSteam001"
local GITHUB_REPO = "OpenSteamTool"

local GITHUB_API =
  "https://api.github.com/repos/" ..
  GITHUB_OWNER ..
  "/" ..
  GITHUB_REPO

-- ============================================================================
-- Minimal JSON Decoder
-- ============================================================================

local function json_parse(str, pos)
  pos = pos or 1

  while pos <= #str do
    local c = str:sub(pos, pos)

    if (
      c == " " or
      c == "\t" or
      c == "\n" or
      c == "\r"
    ) then
      pos = pos + 1
    else
      break
    end
  end

  if pos > #str then
    return nil
  end

  local c = str:sub(pos, pos)

  if c == "{" then
    local obj = {}
    local expecting_key = true
    local key = nil

    pos = pos + 1

    while pos <= #str do
      local w = str:sub(pos, pos)

      if (
        w == " " or
        w == "\t" or
        w == "\n" or
        w == "\r"
      ) then
        pos = pos + 1
      elseif w == "}" then
        return obj, pos + 1
      elseif w == ":" then
        expecting_key = false
        pos = pos + 1
      elseif w == "," then
        expecting_key = true
        pos = pos + 1
      elseif expecting_key then
        local parsed_key, next_pos =
          json_parse(str, pos)

        if parsed_key == nil then
          return nil
        end

        key = parsed_key
        pos = next_pos
      else
        local value, next_pos =
          json_parse(str, pos)

        if value == nil then
          return nil
        end

        obj[key] = value
        key = nil
        expecting_key = true
        pos = next_pos
      end
    end

    return obj, pos
  elseif c == "[" then
    local arr = {}

    pos = pos + 1

    while pos <= #str do
      local w = str:sub(pos, pos)

      if (
        w == " " or
        w == "\t" or
        w == "\n" or
        w == "\r"
      ) then
        pos = pos + 1
      elseif w == "]" then
        return arr, pos + 1
      elseif w == "," then
        pos = pos + 1
      else
        local value, next_pos =
          json_parse(str, pos)

        if value == nil then
          return nil
        end

        table.insert(arr, value)
        pos = next_pos
      end
    end

    return arr, pos
  elseif c == '"' then
    local end_pos = pos + 1

    while end_pos <= #str do
      local sc = str:sub(end_pos, end_pos)

      if sc == "\\" then
        end_pos = end_pos + 2
      elseif sc == '"' then
        break
      else
        end_pos = end_pos + 1
      end
    end

    if end_pos > #str then
      return nil
    end

    local value =
      str:sub(pos + 1, end_pos - 1)

    value = value
      :gsub('\\"', '"')
      :gsub("\\\\", "\\")
      :gsub("\\/", "/")
      :gsub("\\n", "\n")
      :gsub("\\r", "\r")
      :gsub("\\t", "\t")

    return value, end_pos + 1
  elseif (
    c == "t" and
    str:sub(pos, pos + 3) == "true"
  ) then
    return true, pos + 4
  elseif (
    c == "f" and
    str:sub(pos, pos + 4) == "false"
  ) then
    return false, pos + 5
  elseif (
    c == "n" and
    str:sub(pos, pos + 3) == "null"
  ) then
    return nil, pos + 4
  else
    local end_pos = pos

    while end_pos <= #str do
      local nc = str:sub(end_pos, end_pos)

      if (
        (nc >= "0" and nc <= "9") or
        nc == "-" or
        nc == "+" or
        nc == "." or
        nc == "e" or
        nc == "E"
      ) then
        end_pos = end_pos + 1
      else
        break
      end
    end

    local number_text =
      str:sub(pos, end_pos - 1)

    local number_value =
      tonumber(number_text)

    if number_value == nil then
      return nil
    end

    return number_value, end_pos
  end
end

local function json_decode(str)
  local value = json_parse(str, 1)
  return value
end

-- ============================================================================
-- Helpers
-- ============================================================================

local function log(level, message)
  lumaforge.log(
    level,
    "[OPENSTEAMTOOL] " .. message
  )
end

local function validate_steam_root(steam_root)
  if (
    steam_root == nil or
    steam_root == ""
  ) then
    error(
      "Steam root directory not provided"
    )
  end

  if not lumaforge.file_exists(steam_root) then
    error(
      "Steam root directory does not exist: " ..
      steam_root
    )
  end

  return steam_root
end

local function exists(path)
  return lumaforge.file_exists(path)
end

local function rename(from, to)
  log(
    "DEBUG",
    "rename " .. from .. " -> " .. to
  )

  local result =
    lumaforge.rename_file(from, to)

  if result == false then
    error(
      "Failed to rename: " ..
      from ..
      " -> " ..
      to
    )
  end

  return result
end

local function remove(path)
  log(
    "DEBUG",
    "remove " .. path
  )

  return lumaforge.remove_file(path)
end

local function config_folder(steam_root)
  return steam_root .. "\\config"
end

local function lua_folder(steam_root)
  return config_folder(steam_root) ..
    "\\lua"
end

local function lua_backup(steam_root)
  return config_folder(steam_root) ..
    "\\lua.bak"
end

-- Ensure only Steam/config/lua exists.
--
-- Safety rules:
-- 1. Never create Steam/config.
-- 2. Never delete Steam/config.
-- 3. Never replace Steam/config.
-- 4. If lua exists, preserve it.
-- 5. If lua is missing and legacy lua.bak exists, restore it.
-- 6. If neither exists, create only the lua child directory.
-- 7. If both exist, preserve both without merging or deleting.
local function ensure_lua_folder(steam_root)
  validate_steam_root(steam_root)

  local config_dir =
    config_folder(steam_root)

  local lua_dir =
    lua_folder(steam_root)

  local legacy_lua_backup =
    lua_backup(steam_root)

  if not exists(config_dir) then
    error(
      "Steam config directory does not exist: " ..
      config_dir
    )
  end

  if exists(lua_dir) then
    log(
      "INFO",
      "config/lua already exists; preserving its contents"
    )

    if exists(legacy_lua_backup) then
      log(
        "WARN",
        "Both config/lua and config/lua.bak exist; " ..
        "preserving both without merging or deleting data"
      )
    end

    return lua_dir
  end

  if exists(legacy_lua_backup) then
    log(
      "INFO",
      "Restoring legacy config/lua.bak to config/lua"
    )

    rename(
      legacy_lua_backup,
      lua_dir
    )

    if not exists(lua_dir) then
      error(
        "Failed to restore config/lua from: " ..
        legacy_lua_backup
      )
    end

    log(
      "INFO",
      "Restored config/lua successfully"
    )

    return lua_dir
  end

  log(
    "INFO",
    "Creating only the missing lua directory inside Steam config"
  )

  local created =
    lumaforge.create_dir(lua_dir)

  if created == false then
    error(
      "Failed to create Lua directory: " ..
      lua_dir
    )
  end

  if not exists(lua_dir) then
    error(
      "Lua directory was not created: " ..
      lua_dir
    )
  end

  log(
    "INFO",
    "Created Lua directory: " ..
    lua_dir
  )

  return lua_dir
end

local function fetch_latest_release()
  log(
    "INFO",
    "Fetching latest release from GitHub API"
  )

  local url =
    GITHUB_API .. "/releases/latest"

  local response =
    lumaforge.fetch_url(url)

  if (
    response == nil or
    response == ""
  ) then
    error(
      "GitHub API returned an empty response"
    )
  end

  local data =
    json_decode(response)

  if data == nil then
    error(
      "Failed to parse GitHub API response JSON"
    )
  end

  local tag_name =
    data.tag_name

  if tag_name == nil then
    error(
      "GitHub API response missing tag_name"
    )
  end

  local assets =
    data.assets

  if (
    assets == nil or
    #assets == 0
  ) then
    error(
      "No assets found in the latest GitHub release"
    )
  end

  local matching_assets = {}

  for _, asset in ipairs(assets) do
    local asset_name =
      asset.name

    local asset_url =
      asset.browser_download_url

    if (
      asset_name and
      asset_url and
      asset_name:lower():match("%.zip$")
    ) then
      table.insert(
        matching_assets,
        {
          name = asset_name,
          url = asset_url
        }
      )
    end
  end

  if #matching_assets == 0 then
    error(
      "No ZIP asset found in the latest GitHub release"
    )
  end

  if #matching_assets > 1 then
    local matching_names = {}

    for _, asset in ipairs(
      matching_assets
    ) do
      table.insert(
        matching_names,
        asset.name
      )
    end

    error(
      "Multiple ZIP assets found; selection is ambiguous: " ..
      table.concat(
        matching_names,
        ", "
      )
    )
  end

  local selected_asset =
    matching_assets[1]

  log(
    "INFO",
    "Selected release " ..
    tag_name ..
    " asset " ..
    selected_asset.name
  )

  return
    selected_asset.url,
    tag_name,
    selected_asset.name
end

local function temp_path(ext_dir, name)
  local temp_dir =
    ext_dir .. "\\temp"

  if not exists(temp_dir) then
    local created =
      lumaforge.create_dir(temp_dir)

    if created == false then
      error(
        "Failed to create extension temp directory: " ..
        temp_dir
      )
    end
  end

  if not exists(temp_dir) then
    error(
      "Extension temp directory does not exist: " ..
      temp_dir
    )
  end

  return temp_dir .. "\\" .. name
end

local function managed_file_path(
  steam_root,
  file_name
)
  return steam_root .. "\\" .. file_name
end

local function managed_backup_path(
  steam_root,
  file_name
)
  return managed_file_path(
    steam_root,
    file_name
  ) .. ".bak"
end

local function verify_all_active_dlls(
  steam_root,
  operation
)
  for _, dll in ipairs(MANAGED_DLLS) do
    local dll_path =
      managed_file_path(
        steam_root,
        dll
      )

    if not exists(dll_path) then
      error(
        "Verification failed after " ..
        operation ..
        ": " ..
        dll ..
        " was not found in Steam root"
      )
    end
  end
end

local function verify_all_backup_dlls(
  steam_root,
  operation
)
  for _, dll in ipairs(MANAGED_DLLS) do
    local backup_path =
      managed_backup_path(
        steam_root,
        dll
      )

    if not exists(backup_path) then
      error(
        "Verification failed after " ..
        operation ..
        ": " ..
        dll ..
        ".bak was not found in Steam root"
      )
    end
  end
end

local function cleanup_temp_file(path)
  pcall(function()
    if exists(path) then
      remove(path)
    end
  end)
end

-- ============================================================================
-- Detect
-- ============================================================================

local function detect(steam_root)
  validate_steam_root(steam_root)

  log(
    "INFO",
    "detect(steam_root=" ..
    steam_root ..
    ")"
  )

  local installed = {}
  local missing = {}
  local backups = {}

  for _, dll in ipairs(MANAGED_DLLS) do
    local dll_path =
      managed_file_path(
        steam_root,
        dll
      )

    local backup_path =
      managed_backup_path(
        steam_root,
        dll
      )

    if exists(dll_path) then
      table.insert(
        installed,
        dll
      )
    else
      table.insert(
        missing,
        dll
      )
    end

    if exists(backup_path) then
      table.insert(
        backups,
        dll
      )
    end
  end

  local all_installed =
    #installed == #MANAGED_DLLS

  local all_backed_up =
    #backups == #MANAGED_DLLS

  local status

  if (
    #installed == 0 and
    #backups == 0
  ) then
    status = "available"
  elseif (
    all_backed_up and
    #installed == 0
  ) then
    status = "disabled"
  elseif all_installed then
    status = "enabled"
  else
    status = "installed"
  end

  log(
    "INFO",
    "detect status=" ..
    status ..
    " installed=" ..
    #installed ..
    " missing=" ..
    #missing ..
    " backups=" ..
    #backups
  )

  return {
    success = true,
    status = status,
    installedFiles = installed,
    missingFiles = missing,
    backupFiles = backups,
    installedVersion = nil
  }
end

-- ============================================================================
-- Install
-- ============================================================================

local function install(steam_root)
  validate_steam_root(steam_root)

  log(
    "INFO",
    "install(steam_root=" ..
    steam_root ..
    ")"
  )

  -- Steam/config is shared and must already exist.
  local config_dir =
    config_folder(steam_root)

  if not exists(config_dir) then
    error(
      "Steam config directory does not exist: " ..
      config_dir
    )
  end

  local current =
    detect(steam_root)

  if (
    current.status == "enabled" and
    #current.installedFiles ==
      #MANAGED_DLLS
  ) then
    local existing_lua_dir =
      ensure_lua_folder(steam_root)

    log(
      "INFO",
      "Already fully installed; Lua directory ready: " ..
      existing_lua_dir
    )

    return {
      success = true,
      status = "enabled"
    }
  end

  local ext_dir =
    lumaforge.get_extension_dir(
      EXTENSION_ID
    )

  if (
    ext_dir == nil or
    ext_dir == ""
  ) then
    error(
      "Failed to resolve extension directory for " ..
      EXTENSION_ID
    )
  end

  local download_url,
    tag_name,
    asset_name =
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
    "Downloading asset " ..
    asset_name ..
    " to " ..
    zip_path
  )

  local download_result =
    lumaforge.download_file(
      download_url,
      zip_path
    )

  if download_result == false then
    error(
      "Failed to download OpenSteamTool release asset"
    )
  end

  if not exists(zip_path) then
    error(
      "Downloaded ZIP file does not exist: " ..
      zip_path
    )
  end

  local extract_dir =
    temp_path(
      ext_dir,
      "extracted-" ..
      safe_tag
    )

  if not exists(extract_dir) then
    local created =
      lumaforge.create_dir(
        extract_dir
      )

    if created == false then
      error(
        "Failed to create extraction directory: " ..
        extract_dir
      )
    end
  end

  log(
    "INFO",
    "Extracting release to " ..
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
    cleanup_temp_file(zip_path)

    error(
      "No managed DLLs were extracted from the release archive"
    )
  end

  log(
    "INFO",
    "Extracted " ..
    #extracted ..
    " managed file(s): " ..
    table.concat(
      extracted,
      ", "
    )
  )

  local extracted_paths = {}

  for _, path in ipairs(extracted) do
    local normalized =
      tostring(path):gsub(
        "/",
        "\\"
      )

    local file_name =
      normalized:match(
        "([^\\]+)$"
      )

    if file_name then
      extracted_paths[
        file_name:lower()
      ] = normalized
    end
  end

  for _, dll in ipairs(MANAGED_DLLS) do
    local extracted_value =
      extracted_paths[
        dll:lower()
      ]

    local source_path = nil

    if extracted_value then
      if exists(extracted_value) then
        source_path =
          extracted_value
      else
        local relative_candidate =
          extract_dir ..
          "\\" ..
          extracted_value

        if exists(relative_candidate) then
          source_path =
            relative_candidate
        end
      end
    end

    if source_path == nil then
      local direct_candidate =
        extract_dir ..
        "\\" ..
        dll

      if exists(direct_candidate) then
        source_path =
          direct_candidate
      end
    end

    if source_path == nil then
      cleanup_temp_file(zip_path)

      error(
        "Required managed DLL was not found after extraction: " ..
        dll
      )
    end

    local destination_path =
      managed_file_path(
        steam_root,
        dll
      )

    local backup_path =
      managed_backup_path(
        steam_root,
        dll
      )

    -- Preserve an existing active file before installing
    -- the downloaded version. Never touch directories here.
    if exists(destination_path) then
      if exists(backup_path) then
        remove(backup_path)
      end

      rename(
        destination_path,
        backup_path
      )

      log(
        "INFO",
        "Backed up existing " ..
        dll
      )
    end

    rename(
      source_path,
      destination_path
    )

    if not exists(destination_path) then
      error(
        "Failed to install " ..
        dll ..
        " into Steam root"
      )
    end

    log(
      "INFO",
      "Installed " ..
      dll ..
      " into Steam root"
    )
  end

  -- This is the only shared-directory operation:
  -- ensure config/lua exists, restore legacy lua.bak only
  -- when lua is absent, and never touch config itself.
  local lua_dir =
    ensure_lua_folder(steam_root)

  log(
    "INFO",
    "Steam Lua directory ready: " ..
    lua_dir
  )

  verify_all_active_dlls(
    steam_root,
    "install"
  )

  cleanup_temp_file(zip_path)

  log(
    "INFO",
    "Install complete"
  )

  return {
    success = true,
    status = "enabled",
    version = tag_name
  }
end

-- ============================================================================
-- Enable
-- ============================================================================

local function enable(steam_root)
  validate_steam_root(steam_root)

  log(
    "INFO",
    "enable(steam_root=" ..
    steam_root ..
    ")"
  )

  local config_dir =
    config_folder(steam_root)

  if not exists(config_dir) then
    error(
      "Steam config directory does not exist: " ..
      config_dir
    )
  end

  local any_work = false

  for _, dll in ipairs(MANAGED_DLLS) do
    local dll_path =
      managed_file_path(
        steam_root,
        dll
      )

    local backup_path =
      managed_backup_path(
        steam_root,
        dll
      )

    if exists(backup_path) then
      if exists(dll_path) then
        remove(dll_path)
      end

      rename(
        backup_path,
        dll_path
      )

      any_work = true

      log(
        "INFO",
        "Enabled " ..
        dll
      )
    elseif not exists(dll_path) then
      error(
        "Cannot enable incomplete installation; " ..
        dll ..
        " and its backup are missing"
      )
    end
  end

  -- Compatibility recovery:
  -- - existing lua is preserved;
  -- - legacy lua.bak is restored only if lua is absent;
  -- - otherwise only lua is created inside existing config.
  local lua_dir =
    ensure_lua_folder(steam_root)

  log(
    "INFO",
    "Steam Lua directory ready: " ..
    lua_dir
  )

  verify_all_active_dlls(
    steam_root,
    "enable"
  )

  if not any_work then
    log(
      "INFO",
      "Already enabled; no DLL changes were required"
    )
  end

  return {
    success = true,
    status = "enabled"
  }
end

-- ============================================================================
-- Disable
-- ============================================================================

local function disable(steam_root)
  validate_steam_root(steam_root)

  log(
    "INFO",
    "disable(steam_root=" ..
    steam_root ..
    ")"
  )

  local any_work = false

  for _, dll in ipairs(MANAGED_DLLS) do
    local dll_path =
      managed_file_path(
        steam_root,
        dll
      )

    local backup_path =
      managed_backup_path(
        steam_root,
        dll
      )

    if exists(dll_path) then
      if exists(backup_path) then
        remove(backup_path)
      end

      rename(
        dll_path,
        backup_path
      )

      any_work = true

      log(
        "INFO",
        "Disabled " ..
        dll
      )
    elseif not exists(backup_path) then
      error(
        "Cannot disable incomplete installation; " ..
        dll ..
        " and its backup are missing"
      )
    end
  end

  -- config and config/lua are shared directories.
  -- Disable must never move, rename, delete, clear,
  -- recreate, or back up either directory.
  log(
    "INFO",
    "Preserving shared Steam config and config/lua directories"
  )

  verify_all_backup_dlls(
    steam_root,
    "disable"
  )

  if not any_work then
    log(
      "INFO",
      "Already disabled; no DLL changes were required"
    )
  end

  return {
    success = true,
    status = "disabled"
  }
end

-- ============================================================================
-- Uninstall
-- ============================================================================

local function uninstall(steam_root)
  validate_steam_root(steam_root)

  log(
    "INFO",
    "uninstall(steam_root=" ..
    steam_root ..
    ")"
  )

  local any_work = false

  for _, dll in ipairs(MANAGED_DLLS) do
    local dll_path =
      managed_file_path(
        steam_root,
        dll
      )

    local backup_path =
      managed_backup_path(
        steam_root,
        dll
      )

    if exists(dll_path) then
      remove(dll_path)
      any_work = true

      log(
        "INFO",
        "Removed " ..
        dll
      )
    end

    if exists(backup_path) then
      remove(backup_path)
      any_work = true

      log(
        "INFO",
        "Removed " ..
        dll ..
        ".bak"
      )
    end
  end

  -- config and config/lua are shared directories.
  -- Uninstall must never move, rename, delete, clear,
  -- recreate, or back up either directory.
  --
  -- A legacy config/lua.bak is also preserved.
  -- It may contain user data produced by an older
  -- lifecycle implementation and must not be deleted.
  log(
    "INFO",
    "Preserving Steam config, config/lua, and any legacy config/lua.bak"
  )

  for _, dll in ipairs(MANAGED_DLLS) do
    local dll_path =
      managed_file_path(
        steam_root,
        dll
      )

    local backup_path =
      managed_backup_path(
        steam_root,
        dll
      )

    if (
      exists(dll_path) or
      exists(backup_path)
    ) then
      error(
        "Verification failed after uninstall: " ..
        dll ..
        " or " ..
        dll ..
        ".bak still exists"
      )
    end
  end

  if not any_work then
    log(
      "INFO",
      "Nothing to uninstall; managed DLL files were already absent"
    )
  end

  return {
    success = true,
    status = "available"
  }
end

-- ============================================================================
-- Extension Contract
-- ============================================================================

extension = {
  id = EXTENSION_ID,
  name = "OpenSteamTool (Community)",
  version = "1.4.8",
  description =
    "DLL-based Steam integration tool (independent Lua module)",

  detect = detect,
  install = install,
  enable = enable,
  disable = disable,
  uninstall = uninstall
}