"use client";

import { create } from "zustand";
import type { UserProfile } from "@flux/shared";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { ensureProfile } from "@/lib/auth/ensureProfile";
import { updateDisplayName } from "@/lib/auth/profile";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { User } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  initialized: boolean;

  initialize: () => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return;
    if (!isSupabaseConfigured()) {
      set({ loading: false, initialized: true });
      return;
    }
    const supabase = createBrowserSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let profile: UserProfile | null = null;
    if (user) profile = await ensureProfile(user.id);

    set({ user, profile, loading: false, initialized: true });

    supabase.auth.onAuthStateChange(async (_event, session) => {
      const nextUser = session?.user ?? null;
      let nextProfile: UserProfile | null = null;
      if (nextUser) nextProfile = await ensureProfile(nextUser.id);
      set({ user: nextUser, profile: nextProfile });
    });
  },

  signUp: async (email, password, displayName) => {
    const supabase = createBrowserSupabase();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      if (error.message.includes("Database error saving new user")) {
        throw new Error(
          "Account setup failed on the server. Please try again in a moment or contact support if this persists.",
        );
      }
      throw error;
    }
    if (!data.user) throw new Error("Sign up failed");

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      throw new Error("Check your email to confirm your account, then sign in.");
    }

    let profile = await ensureProfile(data.user.id);
    if (displayName?.trim() && profile) {
      profile = await updateDisplayName(displayName.trim());
    }
    set({ user: data.user, profile });
  },

  signIn: async (email, password) => {
    const supabase = createBrowserSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const profile = data.user ? await ensureProfile(data.user.id) : null;
    set({ user: data.user, profile });
  },

  signOut: async () => {
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    set({ user: null, profile: null });
  },

  refreshProfile: async () => {
    const { user } = get();
    if (!user) return;
    const profile = await ensureProfile(user.id);
    set({ profile });
  },

  setDisplayName: async (name) => {
    const profile = await updateDisplayName(name);
    set({ profile });
  },
}));
