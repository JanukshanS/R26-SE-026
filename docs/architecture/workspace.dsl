workspace "Kaduna.lk" "Where data travels across the mobile app, the web app, the four backend components and the data stores. Every relationship names WHAT travels and over WHICH protocol." {

    model {
        driver   = person "Driver" "Owns a vehicle. Reports incidents, records OBD trips, files claims."
        provider = person "Service provider" "Tow / mechanic / roadside crew. Accepts and resolves assigned jobs."
        ops      = person "Ops / admin" "Kaduna staff. Watches the live incident board and assigns roles."

        google = softwareSystem "Google Identity" "OAuth 2.0 / PKCE" "External"
        r2     = softwareSystem "Cloudflare R2" "Object store for accident-capture originals and blurred derivatives." "External"
        dongle = softwareSystem "ELM327 OBD-II dongle" "Bluetooth adapter plugged into the vehicle's OBD-II port." "External,Device"

        kaduna = softwareSystem "Kaduna.lk platform" "Roadside-assistance platform: emergency dispatch, predictive maintenance, insurance claims." {

            mobile = container "Mobile app" "Shared (team) - Driver + provider app. Emergency triage, OBD trip recording, guided claim capture." "Expo SDK 54 / React Native" "Client"
            web    = container "Kaduna web" "Shared (team) - Public landing, driver portal, provider console, ops dashboard, admin, /report triage port." "Next.js 16 / React 19" "Client"

            dispatch = container "Dispatch service" "IT22635266 Janukshan S - Incident lifecycle, Bayesian triage engine, ECM provider optimiser. Port 3001." "Node + Express + Prisma"
            geo      = container "Geo-Intelligence service" "IT22633422 Asath M M - 5-factor traffic-impact scoring, uncertainty band, timeline curve, hotspot clusters. Port 5001." "Python + FastAPI"
            predict  = container "Predictive-Maintenance service" "IT22639776 Herath D M S T - Trip ingestion, RUL / health prediction, OBD fault plans, parts marketplace. Port 5000." "Python + FastAPI"
            claims   = container "Claims-Privacy service" "IT22001252 De Silva R K D H - RETIRED. Logic ported 1:1 into Supabase Edge Functions; still deployed at claims.vps.kaduna.lk with no callers." "Python + FastAPI" "Retired"

            edgefn = container "Supabase Edge Functions" "IT22001252 De Silva R K D H - sign-photo-upload (mints presigned R2 PUT + metadata headers) and complete-capture (finalises a capture)." "Deno / TypeScript"
            gotrue = container "Supabase Auth (GoTrue)" "Platform (shared) - Email+password and Google PKCE. Issues the JWT that every other call carries." "Supabase"
            rest   = container "Supabase PostgREST" "Platform (shared) - RLS-scoped table access for app data." "PostgREST"

            appdb = container "App database" "Platform (shared) - profiles (role, provider_id), vehicles, vehicle_insurance, insurance_companies, captures, capture_photos. RLS by auth.uid()." "Supabase Postgres (public schema)" "Database"
            dispdb = container "Dispatch database" "Platform (shared) - Incident, TriageResponse, Provider, DispatchDecision, ResolutionFeedback, BayesianPrior." "Postgres via Prisma (dispatch schema)" "Database"
            preddb = container "Maintenance database" "Platform (shared) - Trips, component health, service records, DTC faults, marketplace parts/garages." "Supabase Postgres (predictive schema)" "Database"
            geodata = container "Geo static datasets" "IT22633422 Asath M M - hotspots.json + stats.json baked into the image; the model itself holds the fitted 5-factor weights." "JSON on disk" "Database"

            # ---- identity -------------------------------------------------
            mobile -> gotrue "Signs up / signs in; receives access + refresh JWT" "HTTPS (supabase-js)"
            web    -> gotrue "Signs in via redirect or Google One Tap; receives JWT" "HTTPS (supabase-js)"
            gotrue -> google "Delegates OAuth consent, exchanges code for identity" "OAuth 2.0 PKCE"
            gotrue -> appdb  "Writes auth.users; trigger handle_new_user seeds the profile row" "SQL"

            # ---- app data (profiles / vehicles / insurance) ---------------
            mobile -> rest "Reads+writes profile, vehicles, vehicle_insurance; reads insurance_companies" "HTTPS + JWT"
            web    -> rest "Reads profile+role, vehicles, captures; calls admin_set_role RPC" "HTTPS + JWT"
            rest   -> appdb "Executes the RLS-filtered query" "SQL"

            # ---- emergency spine -----------------------------------------
            mobile -> dispatch "POST /incidents {gps, vehicleInfo}; POST /triage/submit {responses}; POST /dispatch/optimize {incidentId}; GET /incidents/{id}" "HTTPS + Supabase JWT"
            web    -> dispatch "GET /incidents?limit=15 (ops board); POST /incidents + /triage/submit from /report; provider console polls every 5s" "HTTPS + Supabase JWT"
            dispatch -> geo "POST /v1/score {lat, lng, incident_type, hour, day_of_week, lanes_blocked from triage service type} -> impact score 1-10; 2s timeout, falls back to neutral 5" "HTTPS + JWT (server-side)"
            dispatch -> dispdb "Persists incidents, triage responses, dispatch decisions, resolution feedback, Bayesian priors" "SQL (Prisma)"
            dispatch -> rest "Ownership check: reads the caller's own profiles.provider_id with the caller's own token before returning provider-scoped incidents" "HTTPS + caller JWT"

            provider -> mobile "Views assigned jobs, accepts/declines, reports the actual service type and minutes"
            provider -> web "Same job loop from the browser provider console"

            # ---- predictive maintenance ----------------------------------
            dongle -> mobile "Live OBD-II PIDs (RPM, coolant, voltage, speed) and mode-03 DTC scan" "Bluetooth SPP / BLE"
            mobile -> predict "POST /process-trip {summarised trip + behaviour + DTC scan}; GET vehicle health, RUL, service history, fault plans, marketplace" "HTTPS + JWT"
            web    -> predict "GET vehicle health / summary / marketplace for the driver portal" "HTTPS + JWT"
            predict -> preddb "Stores trip summaries and derived component health; raw readings are discarded after summarising" "SQL (SQLAlchemy)"

            # ---- geo direct reads ----------------------------------------
            web -> geo "GET /v1/hotspots and /v1/stats for the map and KPI tiles; falls back to bundled /data/*.json when unreachable. POST /v1/score for the what-if scorer" "HTTPS + JWT"
            geo -> geodata "Loads hotspot clusters and corpus statistics" "File read"

            # ---- claims capture ------------------------------------------
            mobile -> edgefn "invoke sign-photo-upload {captureId, photoIndex, assetKind, contentType, gps}; invoke complete-capture when every slot is uploaded" "HTTPS + JWT"
            edgefn -> r2 "Signs a scoped PUT URL with the R2 credentials (the only step that holds them)" "AWS SigV4"
            edgefn -> appdb "Updates the captures row status and photo bookkeeping" "SQL (service role)"
            mobile -> r2 "PUTs the photo/video bytes straight to the presigned URL with x-amz-meta GPS headers" "HTTPS binary PUT"
            mobile -> rest "Upserts capture_photos (capture_id, photo_index, asset_kind, r2_key) and reads the driver's own captures" "HTTPS + JWT"

            driver -> mobile "Reports an incident, records trips, files a claim"
            driver -> web "Driver portal: vehicles, incidents matched by plate, claim counts"
            ops -> web "Live incident board, hotspot map, role administration"
        }

        # ---- deployment ---------------------------------------------------
        prod = deploymentEnvironment "Production" {
            deploymentNode "Driver / provider device" "Android or iOS" {
                containerInstance mobile
            }
            deploymentNode "Contabo VPS 169.58.147.190" "Dokploy v0.30.2 + Traefik" {
                deploymentNode "dispatch.vps.kaduna.lk" "Docker" {
                    containerInstance dispatch
                }
                deploymentNode "geo.vps.kaduna.lk" "Docker" {
                    containerInstance geo
                    containerInstance geodata
                }
                deploymentNode "predict.vps.kaduna.lk" "Docker" {
                    containerInstance predict
                }
                deploymentNode "claims.vps.kaduna.lk" "Docker - retired, no callers" {
                    containerInstance claims
                }
                deploymentNode "kaduna.lk" "nginx serving the static Next export" {
                    containerInstance web
                }
            }
            deploymentNode "Supabase" "ap-northeast-2, project ref huynmjagdlkvqcmgdipk" {
                deploymentNode "Auth" "GoTrue" {
                    containerInstance gotrue
                }
                deploymentNode "Edge runtime" "Deno" {
                    containerInstance edgefn
                }
                deploymentNode "API" "PostgREST" {
                    containerInstance rest
                }
                deploymentNode "Postgres" "reached via the Supavisor IPv4 pooler" {
                    containerInstance appdb
                    containerInstance dispdb
                    containerInstance preddb
                }
            }
        }
    }

    views {
        systemContext kaduna "Context" {
            include *
            autolayout lr
        }

        container kaduna "Containers" {
            include *
            autolayout lr
            description "Everything that stores or moves data, and what travels on each edge."
        }

        dynamic kaduna "EmergencySpine" "Emergency dispatch - driver taps Get help through to an assigned provider" {
            driver -> mobile "Taps Get help; the app reads cached GPS"
            mobile -> dispatch "POST /api/v1/incidents {lat, lng, vehicleInfo} - status CREATED"
            dispatch -> dispdb "INSERT Incident"
            mobile -> dispatch "POST /api/v1/triage/submit {incidentId, responses} - Bayesian engine returns service-type probabilities + tier, status DISPATCHING"
            dispatch -> dispdb "INSERT TriageResponse"
            mobile -> dispatch "POST /api/v1/dispatch/optimize {incidentId} - trafficImpactScore omitted on purpose"
            dispatch -> geo "POST /v1/score - lanes_blocked derived from the triage service type; 2s timeout, neutral 5 on failure"
            dispatch -> dispdb "SELECT providers WHERE status = AVAILABLE, then INSERT DispatchDecisions and set status PROVIDER_ASSIGNED"
            dispatch -> mobile "200 {selectedProvider, rankedProviders, metadata.source = geo-intelligence}"
            autolayout lr
        }

        dynamic kaduna "ProviderJobLoop" "Provider job loop - assigned to accepted to resolved" {
            provider -> mobile "Opens the available-jobs list"
            mobile -> dispatch "GET /api/v1/incidents?assignedProviderId=..."
            dispatch -> rest "GET /rest/v1/profiles?select=provider_id with the caller's own token - 403 if it does not match"
            dispatch -> dispdb "SELECT incidents for that provider"
            mobile -> dispatch "POST /api/v1/dispatch/respond {accepted} - status EN_ROUTE, or back to DISPATCHING with assignedProviderId cleared on decline"
            mobile -> dispatch "POST /api/v1/incidents/{id}/resolve {actualServiceType, resolutionTimeMinutes} - status RESOLVED or ESCALATED"
            dispatch -> dispdb "INSERT ResolutionFeedback (predicted vs actual, wasMatch) - closes the Bayesian loop"
            autolayout lr
        }

        dynamic kaduna "ObdTrip" "OBD trip - dongle to component health" {
            dongle -> mobile "Live PIDs during the drive plus a mode-03 DTC scan; per-field simulator fallback when a PID does not answer"
            mobile -> predict "POST /process-trip {distance, duration, harsh-event counts, idle share, DTC scan} - raw samples never leave the phone"
            predict -> preddb "Stores the trip summary and recomputes component health / RUL"
            mobile -> predict "GET /vehicle/{id}/health and /rul and /faults for the health screen"
            autolayout lr
        }

        dynamic kaduna "ClaimCapture" "Guided accident capture - phone to R2" {
            driver -> mobile "Walks the guided capture (walkaround, user verification, third party, drunk-test video)"
            mobile -> rest "INSERT captures row - status pending"
            mobile -> edgefn "invoke sign-photo-upload {captureId, photoIndex, assetKind, contentType, gps}"
            edgefn -> r2 "Signs a scoped PUT URL - the only step holding R2 credentials"
            mobile -> r2 "Binary PUT of the file with x-amz-meta GPS headers, streamed by expo-file-system"
            mobile -> rest "UPSERT capture_photos {r2_key, content_type, byte_size} on (capture_id, photo_index, asset_kind) so a retry is safe"
            mobile -> edgefn "invoke complete-capture once every required slot is present"
            edgefn -> appdb "Marks the capture complete"
            autolayout lr
        }

        deployment kaduna prod "Deployment" {
            include *
            autolayout lr
        }

        styles {
            element "Person" {
                shape person
                background #0f4c81
                color #ffffff
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "Container" {
                background #438dd5
                color #ffffff
            }
            element "Client" {
                shape MobileDevicePortrait
                background #2e7d32
                color #ffffff
            }
            element "Database" {
                shape Cylinder
                background #6b4fbb
                color #ffffff
            }
            element "External" {
                background #8a8a8a
                color #ffffff
            }
            element "Device" {
                shape RoundedBox
                background #8a6d3b
                color #ffffff
            }
            element "Retired" {
                background #b0b0b0
                color #ffffff
                border dashed
                opacity 50
            }
        }
    }

    !docs docs
}
