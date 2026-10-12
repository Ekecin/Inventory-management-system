# Gratitude Technologies Inventory Management

A Next.js App Router inventory manager using Supabase for authentication and database CRUD operations. Built with JavaScript, React, and a responsive UI inspired by the supplied Gratitude Technologies logo.

## Features

- Email/password account creation and sign-in with Supabase Auth
- Product create, read, update, and delete
- Product name, SKU, category, quantity, unit price, reorder level, and supplier
- Dashboard cards for products, total units, inventory value, and low-stock alerts
- Search and category filtering
- Low-stock view and stock status indicators
- NGN currency formatting
- Row-level security policies so authenticated users can only access their own records
- Responsive desktop and mobile layouts

## 1. Requirements

Install Node.js 18.17 or newer and have a Supabase project.

## 2. Configure Supabase

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Open `supabase/schema.sql` from this project, copy its contents into the SQL Editor, and run it. This creates the table and security policies.
4. In Supabase, open **Project Settings → API** (or **Connect**, depending on the dashboard version).
5. Copy the Project URL and the publishable key (or legacy anon key). Never use the `service_role` secret in this frontend app.

## 3. Add environment variables

Copy `.env.example` to `.env.local` in the project root and replace the placeholders:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

The `NEXT_PUBLIC_` prefix is required because this app connects to Supabase from the browser. Only the publishable/anon key is appropriate here; database access is protected by Supabase Auth and row-level security.

## 4. Install and run

From this folder, run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## 5. Create your account

Choose **Create an account** on the sign-in screen. If email confirmation is enabled in Supabase Auth, confirm the email before signing in. You can configure this under **Authentication → Providers → Email** in your Supabase dashboard.

## Important security notes

- Do not put your Supabase `service_role` key in `.env.local` for this project.
- Do not commit `.env.local`; it is ignored by `.gitignore`.
- Keep the SQL row-level security policies enabled.
- This starter is single-user-per-account: each authenticated user sees only their own items. If your team needs shared company-wide inventory, add an organization/team membership model before inviting staff.
- The `NEXT_PUBLIC_` variables are public by design. The publishable key is safe to expose only when RLS and permissions are correctly configured.

## Project structure

```text
app/
  globals.css
  layout.js
  page.js
components/
  InventoryApp.js
lib/
  supabase.js
public/
  gratitude-logo.jpeg
supabase/
  schema.sql
.env.example
```
