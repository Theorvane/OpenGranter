# CSP-compatible published model descriptions

The public management shell links /management/app.css, an explicit static asset with no authentication or private values. It preserves whitespace and wraps long description text through the fixed management-model-description class. Values continue entering textContent only. style-src self remains unchanged; no inline styles or unsafe-inline are introduced.

GET and HEAD share the headers and method/query/body-framing rules of the JavaScript asset. HEAD has no body. Unknown filenames and API requests retain exact application delegation. No cookie/session bridge, filesystem lookup, inference or authority is introduced.
