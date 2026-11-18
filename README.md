# kanso
### Minimalist task micromanagement & focus timer webapp, with an Express.js + PostgreSQL backend and a Next.js frontend

## Install Dependency
```powershell
# All dependencies (run in project root)
npm run install:all
```

## Setup Database & Environment
```sql
# Create PostgreSQL database
CREATE DATABASE kanso;
```

```env
# backend/.env
PORT=4000
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/kanso
JWT_SECRET=your-secret-key-here
FRONTEND_URL=http://localhost:3000

RESEND_API_KEY=your_resend_api_key
MAIL_FROM="Kanso <noreply@yourdomain.com>"

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
```

```env
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## How to run app
```powershell
# Terminal 1 - Backend -> http://localhost:4000
npm run dev:backend

# Terminal 2 - Frontend -> http://localhost:3000
npm run dev:frontend
```


> marcoyap41
