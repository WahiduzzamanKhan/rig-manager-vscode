# Change Log

All notable changes to the "rig-manager" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2025-07-16

### Added

- Launch R Terminal via REditorSupport if installed.
- Command to install R version (macOS only).
- Command to uninstall R version (macOS only).
- `renv` integration: Automatic detection of `renv.lock` files in workspace.
- Smart version switching suggestions based on project requirements.
- Command to manually check renv requirements.
- Configuration options for extension behavior.
  - `rig-manager.statusBar.visible`: Show/hide status bar item
  - `rig-manager.rConsole.autoLaunch`: Auto-launch R console
  - `rig-manager.renv.autoCheck`: Auto-check renv requirements
- MIT License

### Fixed

- Properly dispose of existing R terminals when switching versions.
- Prevent multiple R consoles from being created when switching versions.

### Changed

- Enhanced R version matching with fallback to compatible versions.
- Improved error handling

## [0.2.0] - 2025-07-07

### Added

- Show R version in the status bar.
- Auto activate based on the opened folder/file.
- Auto launch R console.

## [0.1.0] - 2025-07-06

### Added

- Initial project setup.
- Basic project structure and essential files.
- Command to switch R version.