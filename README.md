# Gridiron GM

AI-powered fantasy football assistant. Live at [gridiron-gm.com](https://gridiron-gm.com).

## Tech Stack

- Vite + React + TypeScript
- shadcn-ui + Tailwind CSS
- Supabase (database + edge functions)
- Capacitor (iOS + Android)

## Local Development

```sh
# Install dependencies
npm install

# Start dev server
npm run dev
```

## Mobile (Capacitor)

```sh
npm run cap:sync      # build + sync both platforms
npm run cap:android   # build + sync + open Android Studio
npm run cap:ios       # build + sync + open Xcode
```

## Supabase

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy --all
```
