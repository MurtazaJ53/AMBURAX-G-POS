# Local Development Environment Setup Guide

| Document ID | AMB-OPS-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Developer Experience & DevOps Team |

---

## 1. Prerequisites & Tooling

To run AMBURAX G-POS locally, ensure the following software is installed:

- **Node.js**: v20.x or v22.x LTS
- **npm**: v10.x+
- **PostgreSQL**: v15 or v16
- **Git**: v2.40+
- **Operating System**: Windows 11, macOS, or Ubuntu Linux 22.04+

---

## 2. Step-by-Step Setup Instructions

### Step 1: Clone and Install Dependencies
```bash
git clone <repo-url> G-POS
cd G-POS
npm install
```

### Step 2: Configure Environment Variables
Copy the sample environment file in `apps/web`:
```bash
cd apps/web
cp .env.example .env.local
```
Ensure your `.env.local` contains valid database and session secrets:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gpos_dev?schema=public"
SESSION_SECRET="your-32-character-random-hex-string-here"
NEXT_PUBLIC_APP_URL="http://localhost:3001"
```

### Step 3: Run Database Migrations & Seed
```bash
npx prisma migrate dev
npm run db:seed
```

### Step 4: Launch Dev Server and Background Workers
```bash
# Terminal 1: Launch Next.js Web Server (Port 3001)
npm run dev -- -p 3001

# Terminal 2: Launch Transactional Outbox Worker
npm run outbox:work
```

Open your browser at `http://localhost:3001/pos` to test counter billing.
