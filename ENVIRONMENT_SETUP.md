# Environment Setup

Complete guide for setting up authentication and environment configuration for
the SAP AI Provider.

> **Quick Start:** For a shorter introduction, see the
> [README Quick Start](./README.md#quick-start). **API Details:** For
> configuration options, see
> [API Reference - SAPAIProviderSettings](./API_REFERENCE.md#sapaiprovidersettings).
>
> **Note:** Authentication is identical for all three main-package entrypoints
> (root V3 for AI SDK 6, `/v2` for AI SDK 5 with AI SDK 6 compatibility,
> `/v4` for AI SDK 7) and the standalone `@jerome-benoit/sap-ai-provider-v2`
> package. Examples below use the AI SDK 6 root; select the matching import
> from [Installation](./README.md#installation).

Use Node.js 22.12 or newer for local and deployed applications. The published
package and SAP SDK dependencies rely on Node APIs; passing source-level Edge
tests does not establish pure Edge runtime support.

## Table of Contents

<!-- markdownlint-disable MD051 -->

- [Quick Setup (Local Development)](#quick-setup-local-development)
  - [1️⃣ Get Your Service Key](#1-get-your-service-key)
  - [2️⃣ Configure Environment](#2-configure-environment)
  - [3️⃣ Use in Code](#3-use-in-code)
  - [Running Examples](#running-examples)
- [SAP BTP Deployment](#sap-btp-deployment)
- [Advanced Configuration](#advanced-configuration)
  - [Custom Resource Groups](#custom-resource-groups)
  - [Custom Deployment IDs](#custom-deployment-ids)
  - [Destination Configuration](#destination-configuration)
- [Troubleshooting](#troubleshooting)
  - [❌ Authentication Failed (401)](#authentication-failed-401)
  - [❌ Cannot Find Module 'dotenv'](#cannot-find-module-dotenv)
  - [❌ Deployment Not Found (404)](#deployment-not-found-404)
  - [✅ Verify Configuration](#verify-configuration)
- [Environment Variables Reference](#environment-variables-reference)
- [Security Best Practices](#security-best-practices)
- [Related Documentation](#related-documentation)

<!-- markdownlint-enable MD051 -->

## Quick Setup (Local Development)

> ⚠️ **v2.0+ Change:** Authentication uses `AICORE_SERVICE_KEY` environment
> variable (changed from `SAP_AI_SERVICE_KEY` in v1.x).

### 1️⃣ Get Your Service Key

1. Log into SAP BTP Cockpit
2. Navigate to your subaccount → AI Core service instance
3. Create or view a service key
4. Copy the complete JSON

### 2️⃣ Configure Environment

Create a `.env` file in your project root:

```bash
cp .env.example .env
```

Add your service key:

```bash
# .env
AICORE_SERVICE_KEY='{"serviceurls":{"AI_API_URL":"https://..."},"clientid":"...","clientsecret":"...","url":"https://...","credential-type":"binding-secret"}'
```

### 3️⃣ Use in Code

```typescript
import "dotenv/config"; // Load environment variables
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";

// Authentication is automatic via AICORE_SERVICE_KEY
const provider = createSAPAIProvider();
const model = provider("gpt-4.1");
```

> 💡 **Key v2.0 changes:** Provider creation is synchronous (no `await`), no
> `serviceKey` parameter needed.

### Running Examples

All examples in `examples/` use this authentication method:

```bash
npx tsx examples/example-generate-text.ts
npx tsx examples/example-streaming-chat.ts
```

---

## SAP BTP Deployment

When deployed on SAP BTP with service bindings, authentication is **fully
automatic** via `VCAP_SERVICES`:

```typescript
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";

// No manually configured service key needed - uses VCAP_SERVICES binding
const provider = createSAPAIProvider();
const model = provider("gpt-4.1");
```

**Authentication priority:** The SAP AI SDK checks credentials in this order:

1. Explicit `destination` configuration, when provided
2. `AICORE_SERVICE_KEY` environment variable
3. `VCAP_SERVICES` (SAP BTP service binding)

---

## Environment Variables Reference

| Variable                  | Description                                                    | Required    |
| ------------------------- | -------------------------------------------------------------- | ----------- |
| `AICORE_SERVICE_KEY`      | SAP AI Core service key JSON (local development)               | Yes (local) |
| `VCAP_SERVICES`           | Service bindings (auto-detected on SAP BTP)                    | Yes (BTP)   |
| `SAP_CLOUD_SDK_LOG_LEVEL` | Log level for SAP Cloud SDK (`debug`, `info`, `warn`, `error`) | No          |

**Example with debugging enabled:**

```bash
# .env
AICORE_SERVICE_KEY='{"serviceurls":{...}}'
SAP_CLOUD_SDK_LOG_LEVEL=debug
```

---

## Advanced Configuration

### Custom Resource Groups

```typescript
const provider = createSAPAIProvider({
  resourceGroup: "production", // Default: "default"
});
```

### Custom Deployment IDs

```typescript
const provider = createSAPAIProvider({
  deploymentId: "d65d81e7c077e583", // Auto-resolved if omitted
});
```

### Destination Configuration

For advanced scenarios with custom HTTP destinations:

```typescript
const provider = createSAPAIProvider({
  destination: {
    // Custom destination configuration
  },
});
```

---

## Troubleshooting

### ❌ Authentication Failed (401)

**Symptoms:** "Invalid token", "Authentication failed", HTTP 401

**Solutions:**

1. Check presence without printing credentials:
   `node -e 'console.log("Service key loaded:", !!process.env.AICORE_SERVICE_KEY)'`
2. Validate JSON syntax (use a JSON validator)
3. Check service key hasn't expired in SAP BTP Cockpit
4. Ensure `import "dotenv/config";` is at the top of your entry file

### ❌ Cannot Find Module 'dotenv'

**Solution:**

```bash
npm install dotenv
```

### ❌ Deployment Not Found (404)

**Solutions:**

1. Verify deployment is running in SAP BTP Cockpit
2. Check `resourceGroup` matches your deployment
3. Confirm model ID is available in your region

### ✅ Verify Configuration

Check environment variable is loaded:

```typescript
import "dotenv/config";
console.log("Service key loaded:", !!process.env.AICORE_SERVICE_KEY);
```

Verify service key structure:

```typescript
const key = JSON.parse(process.env.AICORE_SERVICE_KEY || "{}");
console.log("OAuth URL:", key.url);
console.log("AI API URL:", key.serviceurls?.AI_API_URL);
```

**For complete troubleshooting guide:**
[Troubleshooting Guide](./TROUBLESHOOTING.md)

---

## Security Best Practices

🔒 **Protect Credentials:**

- Never commit `.env` files to version control
- Add `.env` to `.gitignore`
- Use secrets management in production (AWS Secrets Manager, Azure Key Vault,
  etc.)

🔄 **Rotate Keys Regularly:**

- Rotate service keys every 90 days
- Use separate keys for development and production

🚫 **Avoid Logging Secrets:**

- Never log `AICORE_SERVICE_KEY` values
- Redact credentials from error reports and crash logs

✅ **Validate Configuration:**

- Check service key format before deployment
- Test authentication in staging environment first

---

## Related Documentation

- [README - Authentication](./README.md#authentication) - Quick authentication overview
- [API Reference - Configuration](./API_REFERENCE.md#sapaiprovidersettings) - Configuration
  options
- [Migration Guide - Authentication](./MIGRATION_GUIDE.md#2-update-authentication) -
  Authentication changes in v2.0
