'use client';

import { Authenticated, Unauthenticated, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import Link from 'next/link';
import { useAuth } from '@workos-inc/authkit-nextjs/components';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';

export default function Home() {
  const { user, signOut } = useAuth();

  return (
    <>
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-row justify-between items-center">
        <span className="font-semibold tracking-tight">PromoVid</span>
        {user ? <UserMenu email={user.email} onSignOut={signOut} /> : null}
      </header>
      <main className="p-6 md:p-10 max-w-3xl mx-auto flex flex-col gap-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Website → promo video</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Paste a URL, generate a narrated draft with screenshots, then refine clips and re-export.
          </p>
        </div>
        <Authenticated>
          <Dashboard />
        </Authenticated>
        <Unauthenticated>
          <SignInForm />
        </Unauthenticated>
      </main>
    </>
  );
}

function UserMenu({ email, onSignOut }: { email: string | undefined; onSignOut: () => void }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-600 dark:text-slate-400 truncate max-w-[200px]">{email}</span>
      <button
        type="button"
        onClick={() => onSignOut()}
        className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        Sign out
      </button>
    </div>
  );
}

function SignInForm() {
  return (
    <div className="flex flex-col gap-4 w-full max-w-sm">
      <p className="text-slate-600 dark:text-slate-400">Sign in to create projects and render videos.</p>
      <div className="flex gap-3">
        <a
          href="/sign-in"
          className="inline-flex justify-center rounded-md bg-foreground text-background px-4 py-2 font-medium"
        >
          Sign in
        </a>
        <a
          href="/sign-up"
          className="inline-flex justify-center rounded-md border border-slate-300 dark:border-slate-600 px-4 py-2 font-medium"
        >
          Sign up
        </a>
      </div>
    </div>
  );
}

function Dashboard() {
  const router = useRouter();
  const projects = useQuery(api.projects.listMine, { limit: 30 });
  const createProject = useMutation(api.projects.create);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      const id = await createProject({ sourceUrl: url.trim() });
      router.push(`/project/${id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Website URL</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-2 text-sm"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'New project'}
          </button>
        </div>
      </form>

      <section>
        <h2 className="text-lg font-semibold mb-3">Your projects</h2>
        {projects === undefined ? (
          <p className="text-slate-500 text-sm">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="text-slate-500 text-sm">No projects yet. Create one above.</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
            {projects.map((p) => (
              <li key={p._id}>
                <Link
                  href={`/project/${p._id}`}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/50"
                >
                  <span className="font-medium truncate">{p.title ?? p.sourceUrl}</span>
                  <span className="text-xs uppercase tracking-wide text-slate-500">{p.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
