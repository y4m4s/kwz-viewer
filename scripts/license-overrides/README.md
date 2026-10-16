# Dependency license supplements

Some resolved crates omit license texts from their published archives. `sources.json`
maps exact crate versions to upstream license copies. The build fails when a resolved
crate has neither a packaged license nor a reviewed supplement. Review this mapping
when updating dependencies; do not apply an old supplement to a new version automatically.

- `alloc-stdlib-BSD.txt`: upstream LICENSE at the crate's `.cargo_vcs_info.json` commit.
- `tauri-plugin-MIT.txt`: MIT option from upstream LICENSE-MIT at the published commit.
- `webview2-MIT.txt`: upstream LICENSE for webview2-rs. Both published revisions
  `edc2caf886175ccaebe86078c9cfe1ae2a187328` and
  `dffa41a8a46d3f5565eefbff2de57d38d399f158` use this license.
- `selectors-MPL.txt`: unmodified MPL 2.0 text, copied from the resolved cssparser
  archive. selectors declares MPL-2.0 in its manifest and source headers.
- `WebView2-SDK.txt` and `WebView2-SDK-NOTICE.txt`: unmodified LICENSE.txt and NOTICE.txt
  from Microsoft's NuGet package `Microsoft.Web.WebView2` 1.0.3650.58, the SDK version
  recorded by webview2-com-sys 0.39.1.

The generated notices identify original source downloads for all selected crates,
including MPL dependencies. These crates are used without source modifications.
Rust standard-library notices are copied from the active compiler's distribution.

These files concern third-party code; they do not set a license for kwz-viewer's own code.
