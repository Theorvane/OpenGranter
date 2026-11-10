# Bounded browser usage pages (#642)

1. Reproduce the public usage client accepting more rows than the requested page size, including the API default of 50. This is a client contract defect, not a new authorization or session policy.
2. Reject the whole JSON response as unavailable when rows exceed the captured requested limit (default 50). Do not truncate rows or fabricate pagination/cursors. Preserve explicit limits through 100 and existing scope checks. CSV semantics remain unchanged.
3. Add public-client RED cases for explicit/default overfull pages, boundary success and mutation of caller filters while transport is pending. Implement the check and run GREEN plus related integration/build tests.
4. Changes are isolated to usage-client and tests/docs; frontend UI ownership is untouched. Submit a dependent PR on #835. Exact-head required CI and independent formal approval remain mandatory. No login, deployment, provider, database or installed acceptance claimed.

5. RED: original eight client tests pass; two new cases fail because overfull data is released. First related run: 120 PASS/2 FAIL. Build CLI failure was missing npm PATH in this local invocation; summary fixture also returned 100 rows despite omitted limit=50. Correct that fixture to a legal 50-row page while retaining maximum-amount decimal carry coverage, not widening production behavior.

6. GREEN: 10/10 focused and 122/122 related serial tests, zero skip. Typecheck, full lint (existing warnings/infos), scripts/check.py and diff check pass. Evidence logs in bot home: og-1330-page-limit-red.log, og-1330-page-limit-green.log, og-1330-related.log, og-1330-related-green.log, og-1330-typecheck.log, og-1330-lint.log. These include loopback HTTP/PGlite and compiled artifact checks, not native-browser login or installed acceptance.
