# Setting up the database

About fifteen minutes, all of it doable on a phone.

## 1. Create it (Vercel)

1. Open the **ClubHub** project in Vercel.
2. **Storage** tab → **Create Database** → **Neon**.
3. Choose the **Free** plan.
4. Region: **Sydney (ap-southeast-2)** — the closest to New Zealand.
5. Connect it to the ClubHub project, all environments.

Vercel adds the connection details to the project automatically. You never
copy a connection string by hand.

## 2. Load it (Neon)

1. From the database in Vercel, **Open in Neon**.
2. **SQL Editor**.
3. Open `db/setup-all.sql` from the repository in GitHub, copy all of it,
   paste it into the editor, **Run**.

It takes a few seconds. You should end with 40 tables.

Run it **once**. If you run it again it stops at the first line with
`type "org_type" already exists` — that is the protection against loading it
twice, not a fault.

## 3. Check the variable (Vercel)

**Settings → Environment Variables.** There must be one called exactly
`DATABASE_URL`. The Neon install normally creates it; if it has only created
`POSTGRES_URL`, add `DATABASE_URL` with the same value.

## 4. Redeploy

**Deployments → the latest → Redeploy.** The build log should now say
`store: postgres` instead of `store: files`.

That is the whole switch. No code changed.

## One thing worth doing

Your builds ran in **Washington (iad1)**. If functions run there and the
database is in Sydney, every query crosses the Pacific twice. Match them:
add `"regions": ["syd1"]` to `vercel.json`. Check your plan allows choosing a
region first.

## What is in it

- MOKNZ, its sixteen dojo and the Japan branch
- A fifteen-grade ladder — **still a placeholder** until the executive confirms
  the real belt order
- Six titles: Senpai, Sensei, Shihan conferred by grade; Renshi, Kyoshi, Hanshi
  awarded
- Five qualifications with expiry: police vet, first aid, referee, examiner,
  child protection

**Four demo people** — Doug, Tane, Aroha, Mia — with invented dates of birth and
`example.nz` addresses. They exist so the admin has something to show. Real
members go in through the importer, not by editing this file.

## If something goes wrong

**`extension "ltree" does not exist`** — the three extensions (`ltree`,
`citext`, `uuid-ossp`) are standard and Neon supports them. If one fails, run
`create extension ltree;` on its own first, then the whole file.

**The site still says `store: files`** — `DATABASE_URL` is missing or misnamed.
Step 3.

**It worked, and you want to go back to files** — delete `DATABASE_URL` and
redeploy. The files in `data/` are still there.
