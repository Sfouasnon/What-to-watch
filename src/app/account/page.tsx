"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";

import { createSupabaseBrowserClient } from "@/lib/supabase";
import styles from "./account.module.css";

export default function AccountPage() {
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(supabase === null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setMessage("Sending a secure sign-in link…");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/` },
    });
    setMessage(error ? error.message : "Check your inbox for the sign-in link.");
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setMessage("Signed out.");
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Link className={styles.back} href="/">← Back to tonight</Link>
        <div className={styles.mark}>W</div>
        <p className={styles.kicker}>ACCOUNT</p>
        <h1>{user ? "You’re signed in." : "Keep your taste with you."}</h1>
        {!ready ? <p className={styles.muted}>Checking your session…</p> : null}

        {ready && !supabase ? (
          <div className={styles.notice}>
            <strong>Demo mode is active.</strong>
            <p>Your profiles are private to this browser. Add the public Supabase environment variables to enable passwordless accounts and cloud persistence.</p>
          </div>
        ) : null}

        {ready && supabase && user ? (
          <div className={styles.signedIn}>
            <span>Signed in as</span>
            <strong>{user.email}</strong>
            <Link href="/">Open your profiles</Link>
            <button type="button" onClick={signOut}>Sign out</button>
          </div>
        ) : null}

        {ready && supabase && !user ? (
          <form className={styles.form} onSubmit={submit}>
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
            <button type="submit">Email me a sign-in link</button>
            <p>No password. The link returns you securely to What to Watch.</p>
          </form>
        ) : null}

        {message ? <p className={styles.message} role="status">{message}</p> : null}
        <p className={styles.privacy}>Profiles remain independent after sign-in. One viewer’s ratings never train another viewer’s model.</p>
      </section>
    </main>
  );
}
