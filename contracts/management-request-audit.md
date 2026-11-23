# Usage-to-audit request correlation

Each authorized usage row offers **View related audit**. It starts a fresh existing audit JSON read using only that row's exact `principal_id` and `request_id`; neither a retained cursor nor prior audit/time/model filters are inherited. Selection is a query, never authority: the existing server independently authorizes `audit:Read`, scopes rows, and audits access.

The screen identifies the selected principal/request and explains that results are limited to the authorized view and are not invoice reconciliation. **Back to usage** preserves the usage page, applied filters and unapplied draft inputs. The selected audit query remains in force for pagination, retry and current-page CSV; manual Apply filters clears the correlation label. Selecting the same row again always reloads audit authorization. Empty, failure and denial retain existing safe states; terminal denial/disposal invalidate both histories and stale actions.

All identifiers are rendered as text and encoded by the existing clients. No raw event details, prompt/response content, credentials, browser authority acquisition, new endpoint or public entry activation is introduced.
