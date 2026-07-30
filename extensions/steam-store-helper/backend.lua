-- Steam Store Helper — LumaForge CDP Proxy Lua Backend
-- Implements bridge API endpoints for provider checking and downloads.
-- Reads provider config from LumaForge/config.json (shared with luma-lite).
local downloads = {}
local providers_cache = nil

-- Provider URL templates — maps provider id to a function that builds
-- the check URL and download URL for a given app_id.
-- Each returns: check_url, download_url, headers_table
local PROVIDER_ADAPTERS = {
    hubcapdb = function(base_url, api_key, app_id)
        local headers = {}
        if api_key and api_key ~= "" then
            headers["Authorization"] = "Bearer " .. api_key
        end
        local check = base_url .. "/api/v1/status/" .. tostring(app_id)
        local download = base_url .. "/api/v1/manifest/" .. tostring(app_id)
        return check, download, headers
    end,
    ryuu = function(base_url, api_key, app_id)
        local headers = {}
        if api_key and api_key ~= "" then
            headers["X-Auth-Key"] = api_key
        end
        local url = base_url .. "/api/download/" .. tostring(app_id)
        return url, url, headers
    end
}

-- Generic adapter: check = GET base_url/{app_id}, download = same
local function generic_adapter(base_url, api_key, app_id)
    local headers = {}
    local url = base_url .. "/" .. tostring(app_id)
    return url, url, headers
end

local function get_config_path()
    local lad = local_appdata()
    if lad and lad ~= "" then
        return lad .. "\\LumaForge\\config.json"
    end
    return ""
end

local function load_providers()
    if providers_cache then
        return providers_cache
    end

    local config_path = get_config_path()
    local raw = config_path ~= "" and file_exists(config_path) and read_file(config_path) or nil
    if not raw then
        log("[steam-store-helper] No config.json found at " .. config_path)
        providers_cache = {}
        return providers_cache
    end

    local ok, config = pcall(json_decode, raw)
    if not ok or not config then
        log("[steam-store-helper] Failed to parse config.json")
        providers_cache = {}
        return providers_cache
    end

    local dl = config.downloads or config
    local raw_providers = dl.providers or {}

    providers_cache = {}
    for _, p in ipairs(raw_providers) do
        local id = p.id or p.name or "unknown"
        local adapter_fn = PROVIDER_ADAPTERS[id] or generic_adapter
        table.insert(providers_cache, {
            id = id,
            name = p.name or id,
            enabled = p.enabled ~= false,
            base_url = p.baseUrl or p.base_url or "",
            api_key = p.apiKey or p.api_key or nil,
            adapter = adapter_fn
        })
    end

    log("[steam-store-helper] Loaded " .. #providers_cache .. " providers from config.json")
    return providers_cache
end

local function check_provider_available(provider, app_id)
    local adapter = provider.adapter or generic_adapter
    local check_url, _, headers = adapter(provider.base_url, provider.api_key, app_id)

    if not check_url or check_url == "" then
        return false, nil, 0
    end

    local resp = http_get_headers(check_url, headers, 10)
    local status = resp.status or 0
    local body = resp.body or ""

    if status ~= 200 then
        return false, nil, status
    end

    if provider.id == "hubcapdb" then
        if body == "" then
            return false, nil, status
        end
        local ok, parsed = pcall(json_decode, body)
        if ok and parsed then
            if parsed.status == "available" then
                return true, check_url, status
            else
                log("[steam-store-helper] HubcapDB status for " .. app_id .. ": " .. tostring(parsed.status))
                return false, nil, status
            end
        end
        log("[steam-store-helper] HubcapDB: failed to parse response body for " .. app_id)
        return false, nil, status
    end

    if provider.id == "ryuu" then
        if body ~= "" then
            local ok, parsed = pcall(json_decode, body)
            if ok and parsed and parsed.error then
                log("[steam-store-helper] Ryuu error for " .. app_id .. ": " .. tostring(parsed.error))
                return false, nil, status
            end
        end
        return true, check_url, status
    end

    return true, check_url, status
end

local function get_provider_stats()
    local apis = load_providers()
    local stats = {}

    for _, api in ipairs(apis) do
        local has_key = api.api_key ~= nil and api.api_key ~= ""
        local entry = {
            id = api.id,
            name = api.name or "Unknown",
            enabled = api.enabled,
            hasKey = has_key
        }

        if api.id == "hubcapdb" and has_key and api.base_url ~= "" then
            local stats_url = api.base_url .. "/api/v1/user/stats"
            local headers = {
                ["Authorization"] = "Bearer " .. api.api_key
            }
            local resp = http_get_headers(stats_url, headers, 10)
            local status = resp.status or 0
            local body = resp.body or ""

            entry.statsStatus = status

            if status == 200 and body ~= "" then
                local ok, parsed = pcall(json_decode, body)
                if ok and parsed then
                    entry.apiKeyExpiresAt = parsed.api_key_expires_at or nil
                    entry.dailyUsage = parsed.daily_usage or 0
                    entry.dailyLimit = parsed.daily_limit or 0
                    entry.canMakeRequests = parsed.can_make_requests
                    entry.remainingToday = nil

                    if type(entry.dailyUsage) == "number" and type(entry.dailyLimit) == "number" then
                        entry.remainingToday = entry.dailyLimit - entry.dailyUsage
                    end
                else
                    log("[steam-store-helper] HubcapDB: failed to parse user stats response")
                end
            else
                log("[steam-store-helper] HubcapDB user stats request failed: HTTP " .. tostring(status))
            end
        end

        table.insert(stats, entry)
    end

    return stats
end

local function check_local_status(app_id)
    local steam = steam_path()
    local lua_path = steam .. "\\config\\lua\\" .. app_id .. ".lua"
    local exists = file_exists(lua_path)
    return {
        ok = true,
        appId = tostring(app_id),
        inLibrary = exists,
        luaPath = lua_path
    }
end

local function handle_providers()
    local apis = load_providers()
    local result = {}
    for _, api in ipairs(apis) do
        local has_key = api.api_key ~= nil and api.api_key ~= ""
        table.insert(result, {
            id = api.id,
            name = api.name or "Unknown",
            enabled = api.enabled,
            hasKey = has_key
        })
    end
    return {
        ok = true,
        providers = result,
        message = #result > 0 and nil or "No providers configured"
    }
end

local function handle_sources(app_id)
    local apis = load_providers()
    local sources = {}
    local unavailable = {}

    for _, api in ipairs(apis) do
        if api.enabled then
            local avail, url, status = check_provider_available(api, app_id)
            local detail_msg
            if avail then
                detail_msg = "Package available"
            elseif status == 0 then
                detail_msg = "Provider unreachable"
            elseif api.id == "hubcapdb" then
                detail_msg = "Game not found on HubcapDB"
            elseif api.id == "ryuu" then
                detail_msg = "Game not found on Ryuu"
            else
                detail_msg = "Not available (HTTP " .. tostring(status) .. ")"
            end
            local source = {
                id = api.id or api.name or "unknown",
                name = api.name or "Unknown",
                available = avail,
                selectable = avail,
                detail = detail_msg,
                total = 0
            }
            if avail then
                table.insert(sources, source)
            else
                table.insert(unavailable, source)
            end
        end
    end

    return {
        ok = true,
        sources = sources,
        unavailableSources = unavailable,
        message = #sources > 0 and nil or "No enabled provider currently has a package for this App ID."
    }
end

local function start_download(app_id, source_id, output_type)
    local request_id = tostring(app_id) .. "-" .. tostring(os.time()) .. "-" .. tostring(math.random(1000, 9999))
    local apis = load_providers()

    local target_api = nil
    for _, api in ipairs(apis) do
        if api.id == source_id or api.name == source_id or api.id:lower() == source_id:lower() or api.name:lower() ==
            source_id:lower() then
            target_api = api
            break
        end
    end

    if not target_api then
        return {
            ok = false,
            message = "Provider not found: " .. tostring(source_id)
        }
    end

    local _, download_url, headers = target_api.adapter(target_api.base_url, target_api.api_key, app_id)

    downloads[request_id] = {
        status = "queued",
        appId = app_id,
        sourceId = source_id,
        outputType = output_type or "lua+manifest",
        url = download_url,
        progress = 0,
        message = "Queued",
        bytesRead = 0,
        totalBytes = 0,
        error = nil,
        startedAt = os.time()
    }

    local dl = downloads[request_id]
    spawn_thread(function()
        dl.status = "downloading"
        dl.message = "Downloading from " .. source_id
        dl.progress = 10

        local resp = http_get_headers(download_url, headers, 120)
        dl.progress = 80

        if not resp.ok then
            dl.status = "failed"
            dl.message = "Download failed: HTTP " .. tostring(resp.status)
            dl.error = "HTTP_" .. tostring(resp.status)
            return
        end

        local body = resp.body or ""
        if #body < 100 then
            dl.status = "failed"
            dl.message = "Response too small to be a valid package"
            dl.error = "INVALID_RESPONSE"
            return
        end

        dl.status = "processing"
        dl.message = "Processing package"
        dl.progress = 90

        local steam = steam_path()
        local lua_dir = steam .. "\\config\\lua"
        local lua_path = lua_dir .. "\\" .. tostring(app_id) .. ".lua"
        write_file(lua_path, body)
        dl.progress = 95
        dl.message = "Installed to " .. lua_path

        dl.status = "completed"
        dl.progress = 100
        dl.message = "Package installed successfully"
    end)

    return {
        ok = true,
        requestId = request_id
    }
end

local function get_download_status(request_id)
    local dl = downloads[request_id]
    if not dl then
        return {
            ok = false,
            status = "failed",
            message = "Download not found",
            errorCode = "NOT_FOUND"
        }
    end

    return {
        ok = true,
        status = dl.status,
        progress = dl.progress or 0,
        message = dl.message or dl.status,
        errorCode = dl.error,
        appId = tostring(dl.appId or ""),
        bytesRead = dl.bytesRead or 0,
        totalBytes = dl.totalBytes or 0
    }
end

local function open_library(app_id)
    steam_open_library(tostring(app_id))
    return {
        ok = true
    }
end

local function path_last_segment(path)
    local last = nil
    for part in path:gmatch("[^/]+") do
        last = part
    end
    return last
end

local function path_after_prefix(path, prefix)
    if path:sub(1, #prefix) == prefix then
        return path:sub(#prefix + 1)
    end
    return nil
end

routes = {}

routes["GET /api/local-status/:id"] = function(req)
    local app_id = path_after_prefix(req.path, "/api/local-status/")
    if not app_id or app_id == "" then
        app_id = path_last_segment(req.path)
    end
    if not app_id or app_id == "" then
        return {
            status = 400,
            body = json_encode({
                ok = false,
                message = "Invalid appId"
            })
        }
    end
    return {
        status = 200,
        body = json_encode(check_local_status(app_id)),
        contentType = "application/json"
    }
end

routes["GET /api/provider-stats"] = function(req)
    return {
        status = 200,
        body = json_encode({
            ok = true,
            providers = get_provider_stats()
        }),
        contentType = "application/json"
    }
end

routes["GET /api/providers"] = function(req)
    return {
        status = 200,
        body = json_encode(handle_providers()),
        contentType = "application/json"
    }
end

routes["GET /api/sources/:id"] = function(req)
    local app_id = path_after_prefix(req.path, "/api/sources/")
    if not app_id or app_id == "" then
        app_id = path_last_segment(req.path)
    end
    if not app_id or app_id == "" then
        return {
            status = 400,
            body = json_encode({
                ok = false,
                message = "Invalid appId"
            })
        }
    end
    return {
        status = 200,
        body = json_encode(handle_sources(app_id)),
        contentType = "application/json"
    }
end

routes["POST /api/download"] = function(req)
    local body = req.json or {}
    local app_id = body.appId or body.app_id
    local source_id = body.sourceId or body.source_id
    local output_type = body.outputType or body.output_type or "lua+manifest"

    if not app_id then
        return {
            status = 400,
            body = json_encode({
                ok = false,
                message = "Missing appId"
            })
        }
    end
    if not source_id then
        return {
            status = 400,
            body = json_encode({
                ok = false,
                message = "Missing sourceId"
            })
        }
    end

    return {
        status = 200,
        body = json_encode(start_download(tostring(app_id), source_id, output_type)),
        contentType = "application/json"
    }
end

routes["GET /api/download-status/:id"] = function(req)
    local request_id = path_after_prefix(req.path, "/api/download-status/")
    if not request_id or request_id == "" then
        return {
            status = 400,
            body = json_encode({
                ok = false,
                message = "Missing requestId"
            })
        }
    end
    return {
        status = 200,
        body = json_encode(get_download_status(request_id)),
        contentType = "application/json"
    }
end

routes["POST /api/open-library/:id"] = function(req)
    local app_id = path_after_prefix(req.path, "/api/open-library/")
    if not app_id or app_id == "" then
        app_id = path_last_segment(req.path)
    end
    if not app_id or app_id == "" then
        return {
            status = 400,
            body = json_encode({
                ok = false,
                message = "Invalid appId"
            })
        }
    end
    return {
        status = 200,
        body = json_encode(open_library(app_id)),
        contentType = "application/json"
    }
end

routes["GET /api/pending-updates"] = function(req)
    log("[auto-update] Manual check requested via /api/pending-updates")
    local ok, updates = pcall(get_pending_updates)
    if not ok then
        return {
            status = 500,
            body = json_encode({
                ok = false,
                message = "Failed to check updates: " .. tostring(updates)
            }),
            contentType = "application/json"
        }
    end
    return {
        status = 200,
        body = json_encode({
            ok = true,
            updates = updates,
            count = #updates
        }),
        contentType = "application/json"
    }
end

log("[steam-store-helper] Backend loaded successfully")
log("[steam-store-helper] Config: " .. get_config_path())

-- ---------------------------------------------------------------------------
-- Auto-Update — Check installed games against remote providers
-- Uses VDF parsing for actual Steam installs + file mtime comparison
-- JS calls GET /api/pending-updates to get the list; no auto-download.
-- ---------------------------------------------------------------------------

local function unescape_vdf(s)
    s = s:gsub("\\\\", "\\")
    s = s:gsub('\\"', '"')
    return s
end

local function parse_vdf(text)
    local result = {}
    local stack = {result}
    local current_key = nil
    local i = 1
    local len = #text

    while i <= len do
        local c = text:sub(i, i)

        if c == '"' then
            local j = i + 1
            while j <= len and text:sub(j, j) ~= '"' do
                if text:sub(j, j) == '\\' and j < len then
                    j = j + 1
                end
                j = j + 1
            end
            local raw = text:sub(i + 1, j - 1)
            i = j + 1

            if current_key == nil then
                current_key = unescape_vdf(raw)
            else
                local top = stack[#stack]
                top[current_key] = unescape_vdf(raw)
                current_key = nil
            end
        elseif c == '{' then
            if current_key then
                local new_tbl = {}
                stack[#stack][current_key] = new_tbl
                table.insert(stack, new_tbl)
                current_key = nil
            end
        elseif c == '}' then
            if #stack > 1 then
                table.remove(stack)
            end
        end
        i = i + 1
    end

    return result
end

local function parse_acf(text)
    return parse_vdf(text)
end

local function get_library_folders()
    local steam = steam_path()
    local vdf_path = steam .. "\\steamapps\\libraryfolders.vdf"
    if not file_exists(vdf_path) then
        vdf_path = steam .. "\\config\\libraryfolders.vdf"
    end
    if not file_exists(vdf_path) then
        return {}
    end

    local raw = read_file(vdf_path)
    if not raw or raw == "" then
        return {}
    end

    local parsed = parse_vdf(raw)
    local folders = {}
    local lf = parsed["libraryfolders"] or parsed

    for key, val in pairs(lf) do
        if type(val) == "table" and val.path then
            table.insert(folders, { id = key, path = val.path })
        end
    end

    return folders
end

local function scan_library_for_games(lib_path)
    local games = {}
    local steamapps = lib_path .. "\\steamapps"
    if not dir_exists(steamapps) then
        return games
    end

    local entries = list_dir(steamapps)
    for _, name in ipairs(entries) do
        local app_id = name:match("^appmanifest_(%d+)%.acf$")
        if app_id then
            local acf_path = steamapps .. "\\" .. name
            local raw = read_file(acf_path)
            if raw and raw ~= "" then
                local ok_acf, parsed = pcall(parse_acf, raw)
                if ok_acf and parsed then
                    local acf = parsed["AppState"] or parsed
                    local state_str = acf["StateFlags"] or "0"
                    local state = tonumber(state_str) or 0
                    local installed = math.floor(state / 4) % 2 == 1
                    if installed then
                        table.insert(games, {
                            app_id = app_id,
                            name = acf["name"] or ("Game " .. app_id),
                            installdir = acf["installdir"] or ""
                        })
                    end
                end
            end
        end
    end

    return games
end

local function get_installed_games()
    local steam = steam_path()
    local lua_dir = steam .. "\\config\\lua"

    local lua_games = {}
    if dir_exists(lua_dir) then
        local entries = list_dir(lua_dir)
        for _, name in ipairs(entries) do
            local app_id = name:match("^(%d+)%.lua$")
            if app_id then
                local lua_path = lua_dir .. "\\" .. name
                local mtime = 0
                local ok, mt = pcall(file_mtime, lua_path)
                if ok then
                    mtime = mt
                end
                lua_games[app_id] = { path = lua_path, mtime = mtime }
            end
        end
    end

    if next(lua_games) == nil then
        return {}
    end

    local libraries = get_library_folders()
    local installed = {}

    local main_steamapps = steam .. "\\steamapps"
    if dir_exists(main_steamapps) then
        local main_games = scan_library_for_games(steam)
        for _, g in ipairs(main_games) do
            installed[g.app_id] = g
        end
    end

    for _, lib in ipairs(libraries) do
        local games = scan_library_for_games(lib.path)
        for _, g in ipairs(games) do
            installed[g.app_id] = g
        end
    end

    local result = {}
    for app_id, info in pairs(lua_games) do
        if installed[app_id] then
            table.insert(result, {
                app_id = app_id,
                lua_path = info.path,
                lua_mtime = info.mtime,
                game_name = installed[app_id].name
            })
        end
    end

    return result
end

local function parse_iso_timestamp(ts)
    if not ts or ts == "" then
        return 0
    end
    -- Normalize: strip timezone suffix, replace T with space
    local normalized = ts:gsub("T", " "):gsub("%+[%d:]+$", ""):gsub("Z$", ""):gsub("%.[%d]+$", "")
    local y, mo, d, h, mi, s = normalized:match("(%d+)%-(%d+)%-(%d+)%s+(%d+):(%d+):(%d+)")
    if not y then
        return 0
    end
    local timestamp = os.time({
        year = tonumber(y),
        month = tonumber(mo),
        day = tonumber(d),
        hour = tonumber(h),
        min = tonumber(mi),
        sec = tonumber(s)
    })
    return timestamp or 0
end

-- ---------------------------------------------------------------------------
-- Lua file header timestamp parser (-- Created: Month DD, YYYY at HH:MM:SS EDT)
-- Reads only the first small section of the file, not the entire file.
-- Returns raw header string for Rust migration, or nil.
-- ---------------------------------------------------------------------------
local function read_lua_header_raw(lua_path)
    if not file_exists(lua_path) then
        return nil
    end
    local raw = read_file(lua_path)
    if not raw or raw == "" then
        return nil
    end
    -- Read only the first 400 bytes (header is always at the top)
    local snippet = raw:sub(1, 400)
    for line in snippet:gmatch("[^\r\n]+") do
        local header_raw = line:match("^%s*%-%-%s*Created:%s*(.+)")
        if header_raw then
            return header_raw
        end
    end
    return nil
end

-- ---------------------------------------------------------------------------
-- Bridge base URL (used by metadata, migration, and download functions)
-- ---------------------------------------------------------------------------
local BRIDGE_BASE = "http://127.0.0.1:21775"

-- ---------------------------------------------------------------------------
-- Load installed package metadata from Rust routes (bulk, once per run)
-- ---------------------------------------------------------------------------
local function load_bulk_metadata()
    local url = BRIDGE_BASE .. "/api/package-metadata/all"
    local ok, resp = pcall(http_get, url, 10)
    if not ok or not resp or not resp.ok then
        log("[auto-update] Failed to load bulk metadata: " .. tostring(resp and resp.body or "error"))
        return nil
    end
    local p_ok, parsed = pcall(json_decode, resp.body)
    if not p_ok or not parsed or not parsed.ok then
        log("[auto-update] Failed to parse bulk metadata response")
        return nil
    end
    return parsed.packages or {}
end

-- ---------------------------------------------------------------------------
-- Migrate Lua header to Rust metadata
-- ---------------------------------------------------------------------------
local function migrate_header_to_rust(app_id, provider_id, header_raw, lua_filename)
    local payload = json_encode({
        appId = tostring(app_id),
        providerId = provider_id,
        headerRaw = header_raw,
        luaFilename = lua_filename
    })
    local url = BRIDGE_BASE .. "/api/package-metadata/migrate"
    log("[auto-update] Migrating header for " .. app_id .. " via Rust")
    local ok, resp = pcall(http_post, url, payload, 15)
    if not ok or not resp then
        log("[auto-update] Migration request failed: " .. tostring(resp))
        return nil
    end
    local p_ok, parsed = pcall(json_decode, resp.body)
    if not p_ok or not parsed then
        log("[auto-update] Migration response parse failed")
        return nil
    end
    if not parsed.ok then
        log("[auto-update] Migration rejected: " .. tostring(parsed.message))
        return nil
    end
    return parsed.metadata or nil
end

-- ---------------------------------------------------------------------------
-- Get installed version for an app_id + provider using priority logic
-- Returns: remote_modified_unix, remote_modified_iso, version_source, metadata_record
-- ---------------------------------------------------------------------------
local function get_installed_version(bulk_meta, app_id, provider_id, lua_path, lua_mtime)
    -- Priority 1: Trusted Rust metadata for same provider
    if bulk_meta then
        local app_entry = bulk_meta[app_id]
        if app_entry and app_entry.providers then
            local provider_record = app_entry.providers[provider_id]
            if provider_record and provider_record.versionKnown then
                local file_exists_val = provider_record.fileExists
                -- If metadata says file should exist, verify it does
                if file_exists_val == false then
                    log("[auto-update] AppID " .. app_id .. " metadata exists but lua file missing — considering not installed")
                    return nil, nil, "metadata_file_missing", nil
                end
                local remote_unix = provider_record.remoteModifiedUnix
                local remote_iso = provider_record.remoteModified
                if remote_unix and remote_unix > 0 then
                    log("[auto-update] AppID " .. app_id .. " installed version source: metadata")
                    log("[auto-update] AppID " .. app_id .. " metadata version: " .. tostring(remote_iso) .. " (" .. tostring(remote_unix) .. ")")
                    return remote_unix, remote_iso, "metadata", provider_record
                end
            end
        end
    end

    -- Priority 2: Lua -- Created: header → migrate via Rust
    local header_raw = read_lua_header_raw(lua_path)
    if header_raw then
        log("[auto-update] AppID " .. app_id .. " found Lua header: " .. header_raw)
        local migrated = migrate_header_to_rust(app_id, provider_id, header_raw, app_id .. ".lua")
        if migrated and migrated.remoteModifiedUnix and migrated.remoteModifiedUnix > 0 then
            log("[auto-update] AppID " .. app_id .. " installed version source: lua_header_migration")
            log("[auto-update] AppID " .. app_id .. " migrated version: " .. tostring(migrated.remoteModified) .. " (" .. tostring(migrated.remoteModifiedUnix) .. ")")
            -- Return with fileExists from migration result
            return migrated.remoteModifiedUnix, migrated.remoteModified, "lua_header_migration", migrated
        end
    end

    -- Priority 3: Filesystem mtime fallback (non-trusted, current check only)
    if lua_mtime and lua_mtime > 0 then
        log("[auto-update] AppID " .. app_id .. " installed version source: filesystem_mtime_fallback")
        log("[auto-update] AppID " .. app_id .. " using local mtime fallback because installed version metadata is unavailable")
        return lua_mtime, nil, "filesystem_mtime_fallback", nil
    end

    -- No source
    log("[auto-update] AppID " .. app_id .. " installed version source: none — cannot determine installed version")
    return nil, nil, "none", nil
end

-- ---------------------------------------------------------------------------
-- Check if a specific game needs an update from a provider
-- Uses the new priority: metadata > header > mtime
-- Returns: needs_update, update_info_table
-- ---------------------------------------------------------------------------
local function check_needs_update(provider, game, bulk_meta)
    if provider.id ~= "hubcapdb" then
        return false, nil
    end
    if not provider.api_key or provider.api_key == "" then
        return false, nil
    end

    local check_url = provider.base_url .. "/api/v1/status/" .. tostring(game.app_id)
    local headers = { ["Authorization"] = "Bearer " .. provider.api_key }
    local h_ok, resp = pcall(http_get_headers, check_url, headers, 10)
    if not h_ok or not resp then
        log("[auto-update]   HTTP error querying " .. game.app_id .. ": " .. tostring(resp))
        return false, nil
    end
    local status = resp.status or 0
    local body = resp.body or ""

    if status ~= 200 or body == "" then
        return false, nil
    end

    local ok, parsed = pcall(json_decode, body)
    if not ok or not parsed then
        return false, nil
    end

    if parsed.status ~= "available" then
        return false, nil
    end

    local remote_iso = parsed.file_modified or ""
    local remote_modified = parse_iso_timestamp(remote_iso)
    local remote_size = tonumber(parsed.file_size) or 0

    if remote_modified <= 0 then
        log("[auto-update] AppID " .. game.app_id .. " remote timestamp invalid: " .. remote_iso)
        return false, nil
    end

    -- Determine installed version using priority logic
    local installed_version, installed_iso, version_source, metadata_record =
        get_installed_version(bulk_meta, game.app_id, provider.id, game.lua_path, game.lua_mtime)

    log("[auto-update] AppID " .. game.app_id .. " remote version: " .. remote_iso ..
        " (" .. tostring(remote_modified) .. ")")
    log("[auto-update] AppID " .. game.app_id .. " installed version source: " .. tostring(version_source))
    if installed_version then
        log("[auto-update] AppID " .. game.app_id .. " installed version: " .. tostring(installed_iso or installed_version) ..
            " (" .. tostring(installed_version) .. ")")
    end

    -- If no installed version could be determined, skip (don't assume up-to-date)
    if not installed_version or installed_version <= 0 then
        log("[auto-update] AppID " .. game.app_id .. " update required: unable to determine installed version — skipping")
        return false, nil
    end

    local needs_update = remote_modified > installed_version

    log("[auto-update] AppID " .. game.app_id .. " update required: " .. tostring(needs_update))

    if needs_update then
        log("[auto-update] " .. game.app_id .. " (" .. game.game_name .. "): UPDATE NEEDED — remote (" ..
            tostring(remote_iso) .. ") > installed (" .. tostring(installed_iso or installed_version) .. ")")
    end

    return needs_update, {
        remote_modified = remote_modified,
        file_modified = remote_iso,
        remoteModifiedUnix = remote_modified,
        remoteModified = remote_iso,
        fileSize = remote_size,
        gameName = game.game_name,
        versionSource = version_source,
        metadataRecord = metadata_record,
        luaFilename = game.app_id .. ".lua"
    }
end

function get_pending_updates()
    local games = get_installed_games()
    local updates = {}
    local apis = load_providers()
    local bulk_meta = load_bulk_metadata()

    for _, game in ipairs(games) do
        for _, api in ipairs(apis) do
            if api.enabled and api.api_key and api.api_key ~= "" then
                local needs, metadata = check_needs_update(api, game, bulk_meta)
                if needs and metadata then
                    table.insert(updates, {
                        appId = game.app_id,
                        gameName = metadata.gameName,
                        providerId = api.id,
                        remoteModified = metadata.file_modified,
                        remoteModifiedUnix = metadata.remoteModifiedUnix,
                        remoteSize = metadata.fileSize,
                        reason = metadata.versionSource,
                        luaPath = game.lua_path,
                        luaFilename = metadata.luaFilename
                    })
                    break
                end
            end
        end
        sleep_ms(150)
    end

    return updates
end

-- ---------------------------------------------------------------------------
-- Startup — Check for updates + auto-download via Rust bridge
-- Calls POST /api/download (Rust package_installer) to avoid resp.text()
-- binary corruption. Polls GET /api/download-status/:id until done.
-- ---------------------------------------------------------------------------

local function trigger_download(app_id, source_id, output_type, remote_context)
    local payload = {
        appId = tostring(app_id),
        sourceId = source_id,
        outputType = output_type or "lua+manifest"
    }
    if remote_context then
        if remote_context.remoteModified then
            payload.remoteModified = remote_context.remoteModified
        end
        if remote_context.remoteModifiedUnix then
            payload.remoteModifiedUnix = remote_context.remoteModifiedUnix
        end
    end
    local payload_str = json_encode(payload)
    local post_url = BRIDGE_BASE .. "/api/download"
    log("[auto-update] POST " .. post_url .. " appId=" .. tostring(app_id))

    local resp_ok, resp = pcall(http_post, post_url, payload_str, 30)
    if not resp_ok or not resp then
        log("[auto-update] POST failed: " .. tostring(resp))
        return nil, "POST_FAILED"
    end

    log("[auto-update] POST status=" .. tostring(resp.status) .. " body_len=" .. #(resp.body or ""))

    if not resp.ok then
        log("[auto-update] Download rejected: " .. tostring(resp.body))
        return nil, "HTTP_" .. tostring(resp.status)
    end

    local p_ok, parsed = pcall(json_decode, resp.body)
    if not p_ok or not parsed then
        log("[auto-update] Failed to parse POST response")
        return nil, "PARSE_ERROR"
    end

    if not parsed.ok then
        log("[auto-update] Download not ok: " .. tostring(parsed.message))
        return nil, parsed.message or "NOT_OK"
    end

    local request_id = parsed.requestId or parsed.request_id
    log("[auto-update] Download accepted, requestId=" .. tostring(request_id))
    return request_id, nil
end

local function poll_download_status(request_id, max_wait_secs)
    max_wait_secs = max_wait_secs or 300
    local status_url = BRIDGE_BASE .. "/api/download-status/" .. request_id
    local elapsed = 0

    while elapsed < max_wait_secs do
        sleep_ms(3000)
        elapsed = elapsed + 3

        local resp_ok, resp = pcall(http_get, status_url, 10)
        if not resp_ok or not resp or not resp.ok then
            log("[auto-update] Poll failed (elapsed=" .. elapsed .. "s): " .. tostring(resp and resp.body or "error"))
        else
            local p_ok, parsed = pcall(json_decode, resp.body)
            if p_ok and parsed then
                local st = parsed.status or "unknown"
                local msg = parsed.message or ""
                local progress = parsed.progress or 0
                log("[auto-update] Poll status=" .. st .. " progress=" .. progress .. " msg=" .. msg .. " (elapsed=" .. elapsed .. "s)")

                if st == "completed" then
                    log("[auto-update] Download COMPLETED for " .. tostring(parsed.appId or ""))
                    local files = parsed.files or {}
                    for _, f in ipairs(files) do
                        log("[auto-update]   Installed: " .. f.filename .. " (" .. f.type .. ", " .. f.size .. " bytes)")
                    end
                    return true, nil
                elseif st == "failed" then
                    log("[auto-update] Download FAILED: " .. tostring(parsed.error or msg))
                    return false, parsed.error or "FAILED"
                end
            else
                log("[auto-update] Poll parse error (elapsed=" .. elapsed .. "s)")
            end
        end
    end

    log("[auto-update] Poll TIMEOUT after " .. max_wait_secs .. "s")
    return false, "TIMEOUT"
end

spawn_thread(function()
    local ok, err = pcall(function()
    sleep_ms(2000)
    log("[auto-update] ============================================================")
    log("[auto-update] STARTUP UPDATE CHECK — Auto-Update Enabled")
    log("[auto-update] ============================================================")

    local games = get_installed_games()
    log("[auto-update] Installed games with .lua: " .. #games)

    if #games == 0 then
        log("[auto-update] No games found.")
        return
    end

    local apis = load_providers()
    local enabled_apis = 0
    for _, api in ipairs(apis) do
        if api.enabled and api.api_key and api.api_key ~= "" then
            enabled_apis = enabled_apis + 1
        end
    end
    log("[auto-update] Enabled providers with API key: " .. enabled_apis)

    if enabled_apis == 0 then
        log("[auto-update] No providers with API keys. Cannot check remote dates.")
        return
    end

    -- Load bulk metadata once from Rust (single HTTP call)
    log("[auto-update] Loading installed package metadata from Rust...")
    local bulk_meta = load_bulk_metadata()
    if bulk_meta then
        local count = 0
        for _ in pairs(bulk_meta) do count = count + 1 end
        log("[auto-update] Loaded metadata for " .. count .. " packages")
    else
        log("[auto-update] Metadata unavailable — will rely on header migration and mtime fallback")
    end

    log("[auto-update] ------------------------------------------------------------")

    local games_needing_update = {}
    local count_up_to_date = 0
    local count_needs_update = 0
    local count_skipped = 0
    local count_error = 0

    for _, game in ipairs(games) do
        log("[auto-update] Checking AppID=" .. game.app_id .. " (" .. game.game_name .. ")")

        local local_size = 0
        local fok, fmeta = pcall(function()
            return #read_file(game.lua_path)
        end)
        if fok and fmeta then
            local_size = fmeta
        end
        log("[auto-update]   Local mtime=" .. tostring(game.lua_mtime) ..
            " (" .. os.date("%Y-%m-%d %H:%M:%S", game.lua_mtime) .. ")" ..
            "  size=" .. local_size .. "  path=" .. game.lua_path)

        local checked_remote = false
        for _, api in ipairs(apis) do
            if api.enabled and api.api_key and api.api_key ~= "" then
                checked_remote = true

                if api.id ~= "hubcapdb" then
                    log("[auto-update]   Skipped provider '" .. api.id .. "' (not hubcapdb)")
                else
                    local needs, update_info = check_needs_update(api, game, bulk_meta)
                    if needs and update_info then
                        count_needs_update = count_needs_update + 1
                        table.insert(games_needing_update, {
                            app_id = game.app_id,
                            game_name = game.game_name,
                            source_id = api.id,
                            remoteModified = update_info.remoteModified,
                            remoteModifiedUnix = update_info.remoteModifiedUnix,
                            luaFilename = update_info.luaFilename
                        })
                    elseif update_info then
                        -- update_info present but needs=false means up to date
                        count_up_to_date = count_up_to_date + 1
                    else
                        count_skipped = count_skipped + 1
                    end
                end
                break
            end
        end

        if not checked_remote then
            log("[auto-update]   No provider available for this game")
            count_skipped = count_skipped + 1
        end

        log("[auto-update]   ---")
        sleep_ms(150)
    end

    log("[auto-update] ============================================================")
    log("[auto-update] CHECK PHASE COMPLETE:")
    log("[auto-update]   Total games checked: " .. #games)
    log("[auto-update]   Up to date:          " .. count_up_to_date)
    log("[auto-update]   Need update:         " .. count_needs_update)
    log("[auto-update]   Skipped:             " .. count_skipped)
    log("[auto-update]   Errors:              " .. count_error)
    log("[auto-update] ============================================================")

    if #games_needing_update == 0 then
        log("[auto-update] All games up to date. Nothing to download.")
        return
    end

    log("[auto-update] ============================================================")
    log("[auto-update] DOWNLOAD PHASE — " .. #games_needing_update .. " game(s) to update")
    log("[auto-update] ============================================================")

    local dl_success = 0
    local dl_failed = 0

    for _, update in ipairs(games_needing_update) do
        log("[auto-update] Downloading AppID=" .. update.app_id .. " (" .. update.game_name .. ") from " .. update.source_id)

        local remote_ctx = {
            remoteModified = update.remoteModified,
            remoteModifiedUnix = update.remoteModifiedUnix
        }
        local request_id, err = trigger_download(update.app_id, update.source_id, "lua+manifest", remote_ctx)
        if not request_id then
            log("[auto-update]   FAILED to start download: " .. tostring(err))
            dl_failed = dl_failed + 1
        else
            log("[auto-update]   Waiting for requestId=" .. request_id)
            local ok, poll_err = poll_download_status(request_id, 300)
            if ok then
                log("[auto-update]   SUCCESS: " .. update.app_id .. " (" .. update.game_name .. ") updated")
                dl_success = dl_success + 1
            else
                log("[auto-update]   FAILED: " .. update.app_id .. " — " .. tostring(poll_err))
                dl_failed = dl_failed + 1
            end
        end

        sleep_ms(500)
    end

    log("[auto-update] ============================================================")
    log("[auto-update] DOWNLOAD PHASE COMPLETE:")
    log("[auto-update]   Successful:  " .. dl_success)
    log("[auto-update]   Failed:      " .. dl_failed)
    log("[auto-update] ============================================================")
    end) -- end pcall
    if not ok then
        log("[auto-update] FATAL: " .. tostring(err))
    end
end)
