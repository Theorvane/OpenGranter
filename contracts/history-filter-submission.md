# History filter submission (#642)

Usage and audit filters use semantic forms with a named region and Apply submit button. Enter and submit events use the existing filter parser, first-page load and error states, not a new API. The handler always prevents browser navigation, even for detached controls. Clear remains type=button. Native constraint validation is disabled so the application preserves rejected filter drafts and shows its existing invalid-filter status consistently.

Only the current rendered form with live authority may submit. Navigation, rerender, renewal, logout, expiry and dispose invalidate old forms. No URL/session storage, credentials, IAM change or runtime activation is introduced. Source/artifact event tests are not native-browser acceptance.
