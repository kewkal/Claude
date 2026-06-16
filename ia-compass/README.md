# IA Compass

A self-hosted CRM and marketing platform with follow-up sequences, landing pages, and multi-client agency management.

## Features

- **Multi-tenant Agency** — Manage multiple client accounts under one agency login
- **CRM & Contacts** — Track leads from any source with tags and search
- **Pipeline** — Drag-and-drop kanban board for your deals
- **Follow-up Sequences** — Automated SMS (Twilio) + email (Mailgun) with time-delayed steps
- **Landing Page Builder** — Drag-and-drop builder with form capture
- **Webhooks** — Ingest leads from external tools automatically

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running

## Setup

1. Enter the project directory: `cd ia-compass`
2. Copy env file: `cp .env.example .env`
3. Fill in `.env` with your JWT secret, Twilio, and Mailgun credentials
4. Start: `docker compose up --build`
5. Open: http://localhost:3000

## First-Time Setup

Click **"Create Agency"** on the login screen to register your admin account.

## Webhook Usage

POST to `http://localhost:3001/api/webhooks/{accountId}/contact` with JSON body:
`{ "firstName", "lastName", "email", "phone", "sequenceId" (optional) }`

Get your accountId from Settings > Client Accounts.

## Architecture

| Service | Port |
|---|---|
| Frontend (Next.js) | 3000 |
| Backend (Express) | 3001 |
| PostgreSQL | 5432 |
| Redis | 6379 |
