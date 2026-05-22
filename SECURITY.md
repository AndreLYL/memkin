# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue**
2. Email the maintainer directly or use [GitHub Security Advisories](https://github.com/AndreLYL/digitalbrain-extractor/security/advisories/new)
3. Include steps to reproduce and potential impact

We will respond within 72 hours and work with you on a fix before public disclosure.

## Scope

DBE processes conversation data that may contain sensitive information. Security concerns include:

- **Privacy processor bypass**: Sensitive data leaking through the pipeline without redaction
- **API key exposure**: Keys or tokens appearing in output, logs, or config files
- **Path traversal**: Malicious input causing file reads/writes outside intended directories

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |
