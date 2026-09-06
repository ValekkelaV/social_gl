import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

// Даёт всему приложению: session (supabase auth), person (строка из people:
// full_name, is_owner, telegram_username и т.д.) и memberships (комитеты +
// уровень текущего пользователя). Пока person не подтянут — считаем, что
// auth ещё загружается, т.к. без person нельзя ни отрисовать нав, ни
// проверить права.

const AuthContext = createContext(undefined);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [person, setPerson] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadPersonAndMemberships = useCallback(async (userId) => {
    if (!userId) {
      setPerson(null);
      setMemberships([]);
      return;
    }

    const [{ data: personRow, error: personError }, { data: membershipRows, error: membershipError }] =
      await Promise.all([
        supabase.from("people").select("*").eq("id", userId).maybeSingle(),
        supabase
          .from("committee_memberships")
          .select("committee_id, level, committees(id, name)")
          .eq("person_id", userId),
      ]);

    if (personError) console.error("Ошибка загрузки people:", personError);
    if (membershipError) console.error("Ошибка загрузки committee_memberships:", membershipError);

    setPerson(personRow ?? null);
    setMemberships(membershipRows ?? []);
  }, []);

  useEffect(() => {
    let isMounted = true;

    // Стартовая проверка текущей сессии (напр. после refresh страницы).
    supabase.auth.getSession().then(async ({ data: { session: currentSession } }) => {
      if (!isMounted) return;
      setSession(currentSession);
      await loadPersonAndMemberships(currentSession?.user?.id);
      if (isMounted) setLoading(false);
    });

    // Реагируем на login/logout/refresh токена из любого места приложения
    // (напр. после supabase.auth.setSession() в LoginPage).
    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return;
      setSession(newSession);
      await loadPersonAndMemberships(newSession?.user?.id);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [loadPersonAndMemberships]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setPerson(null);
    setMemberships([]);
  }, []);

  const value = {
    session,
    user: session?.user ?? null,
    person,
    memberships,
    isOwner: !!person?.is_owner,
    loading,
    signOut,
    refreshPerson: () => loadPersonAndMemberships(session?.user?.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth() должен вызываться внутри <AuthProvider>");
  }
  return ctx;
}
