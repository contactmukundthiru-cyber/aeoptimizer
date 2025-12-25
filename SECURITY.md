# Security Policy

## Overview

Pulse for After Effects is designed with security as a priority. This document outlines the security measures in place.

## Network Security

### Localhost Only

**All network communication is restricted to localhost (127.0.0.1).**

- The Node.js worker binds exclusively to `127.0.0.1:3847`
- No external network connections are made
- No data is sent to remote servers
- No analytics or telemetry

### No External Dependencies at Runtime

- The worker does not fetch any external resources during operation
- All functionality is self-contained
- npm packages are only used during installation

## Data Handling

### Project Data

- Project information (comp names, layer names) is only used for hashing and local processing
- No project data leaves the local machine
- Rendered frames are stored locally in the user-specified cache directory

### Cache Directory

- Default location: `~/Pulse_Cache`
- User-configurable
- Contains only rendered frames and logs
- No sensitive data is stored

## File System Access

### Read Operations

- ExtendScript reads project/comp information from the active AE project
- Worker reads configuration and cache files

### Write Operations

- Worker writes rendered frames to cache directory
- Worker writes logs to `pulse.log`
- ExtendScript modifies project layers (swap in/out operations)

### No Destructive Operations

- Original layers are never deleted
- Swap operations are always reversible
- Markers and metadata preserve restoration information

## Process Execution

### aerender

- The only external process executed is Adobe's `aerender`
- Path is validated before execution
- Arguments are sanitized to prevent command injection
- Process runs with same privileges as the worker

## Recommendations

### For Users

1. Keep the cache directory on a local drive (not network-mounted)
2. Don't expose port 3847 to external networks
3. Run the worker with minimum necessary privileges

### For Developers

1. Don't add external API calls without explicit user consent
2. Validate all input from the CEP panel
3. Sanitize file paths before use
4. Log sensitive operations for audit

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it by:

1. Opening a private issue on the repository
2. Describing the vulnerability in detail
3. Including steps to reproduce if applicable

We will respond within 48 hours and work to address the issue promptly.

## Version

This security policy applies to Pulse for After Effects v1.0.0 and later.
