# Audit request correlation in the management view (#637, #642)

1. Preserve the existing explicit trusted authority, fresh server IAM and mandatory audit boundary. No session, cookie, retention, runtime or schema activation.
2. Add an exact Request ID filter to the mounted audit form and browser client, reusing the API parser and response-scope validator from PR830. Encode plus correctly; never trim, lowercase or authorize by correlation ID.
3. Preserve that filter through next/previous and current-page CSV. Clear results and drafts on denial, expiry and authority replacement. Reject malformed filters before transport and mismatched JSON before display.
4. Prove meaningful RED then GREEN: mounted form, browser transport, pagination/export and real signed SSO + SQL + loopback HTTP. Separate structural DOM/loopback evidence from native-browser/company SSO acceptance.
5. Run full type/lint/test checks and request exact-head independent review and mandatory CI. Do not merge without formal approval and successful CI.
