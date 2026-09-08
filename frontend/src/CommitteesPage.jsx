import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthContext";

// Права здесь ровно повторяют RLS (02_rls_policies.sql, 15_auth_whitelist_rls.sql),
// UI просто скрывает недоступные действия — сама защита всё равно на стороне БД.
//   - Создать комитет / писать в whitelist (приглашать) -> только owner
//   - Добавить участника в комитет / поменять уровень / удалить -> owner ИЛИ lead этого комитета

export default function CommitteesPage() {
  const { person, isOwner, memberships: myMemberships } = useAuth();

  const [committees, setCommittees] = useState([]);
  const [allMemberships, setAllMemberships] = useState([]); // все, чтобы посчитать состав каждого комитета
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newCommitteeName, setNewCommitteeName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [{ data: committeeRows, error: cErr }, { data: membershipRows, error: mErr }, { data: peopleRows, error: pErr }] =
      await Promise.all([
        supabase.from("committees").select("id, name, archived_at").order("name"),
        supabase.from("committee_memberships").select("id, person_id, committee_id, level, people(id, full_name, telegram_username)"),
        supabase.from("people").select("id, full_name, telegram_username").order("full_name"),
      ]);

    if (cErr || mErr || pErr) {
      console.error(cErr || mErr || pErr);
      setError("Не удалось загрузить комитеты");
    } else {
      setCommittees(committeeRows ?? []);
      setAllMemberships(membershipRows ?? []);
      setPeople(peopleRows ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const myLeadCommitteeIds = useMemo(
    () => new Set(myMemberships.filter((m) => m.level === "lead").map((m) => m.committee_id)),
    [myMemberships]
  );

  function canManage(committeeId) {
    return isOwner || myLeadCommitteeIds.has(committeeId);
  }

  async function handleCreateCommittee(e) {
    e.preventDefault();
    if (!newCommitteeName.trim()) return;
    setCreating(true);
    setError("");

    const { error: insertError } = await supabase
      .from("committees")
      .insert({ name: newCommitteeName.trim() });

    if (insertError) {
      console.error(insertError);
      setError("Не удалось создать комитет (возможно, такое имя уже есть)");
    } else {
      setNewCommitteeName("");
      await load();
    }
    setCreating(false);
  }

  if (loading) return <p className="text-sm text-gray-500">Загрузка…</p>;

  return (
    <div className="space-y-8 max-w-3xl">
      <h1 className="text-lg font-semibold">Комитеты</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {isOwner && (
        <form onSubmit={handleCreateCommittee} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Новый комитет</label>
            <input
              value={newCommitteeName}
              onChange={(e) => setNewCommitteeName(e.target.value)}
              placeholder="Название комитета"
              className="w-full border rounded p-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !newCommitteeName.trim()}
            className="px-3 py-2 border rounded text-sm font-medium"
          >
            Создать
          </button>
        </form>
      )}

      {isOwner && <InviteForm onDone={load} />}

      <div className="space-y-6">
        {committees.map((c) => (
          <CommitteeCard
            key={c.id}
            committee={c}
            members={allMemberships.filter((m) => m.committee_id === c.id)}
            allPeople={people}
            currentPersonId={person?.id}
            canManage={canManage(c.id)}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}

function InviteForm({ onDone }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim()) return;
    setSubmitting(true);
    setMessage("");

    const { error } = await supabase.from("whitelisted_usernames").insert({
      username: username.trim().replace(/^@/, ""),
      preferred_full_name: displayName.trim() || null,
      note: note.trim() || null,
    });

    if (error) {
      console.error(error);
      setMessage("Не удалось добавить в вайтлист (возможно, такой username уже есть)");
    } else {
      setMessage(`Добавлено: @${username.trim().replace(/^@/, "")}`);
      setUsername("");
      setDisplayName("");
      setNote("");
      onDone?.();
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="border rounded p-4 space-y-3">
      <h2 className="text-sm font-semibold">Пригласить в оргкомитет (вайтлист Telegram)</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Telegram @username *</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="@username"
            className="w-full border rounded p-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Отображаемое имя (вместо имени из Telegram)
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Иванов Иван"
            className="w-full border rounded p-2 text-sm"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Заметка (необязательно)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="напр. комитет СММ"
          className="w-full border rounded p-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={submitting || !username.trim()}
        className="px-3 py-1.5 border rounded text-sm font-medium"
      >
        Добавить в вайтлист
      </button>
      {message && <p className="text-xs text-gray-600">{message}</p>}
      <p className="text-xs text-gray-400">
        Имя применится только при первом входе этого человека — на уже вошедших не влияет.
        После входа человека нужно будет добавить в конкретный комитет ниже.
      </p>
    </form>
  );
}

function CommitteeCard({ committee, members, allPeople, currentPersonId, canManage, onChanged }) {
  const [addingPersonId, setAddingPersonId] = useState("");
  const [addingLevel, setAddingLevel] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const memberPersonIds = new Set(members.map((m) => m.person_id));
  const addableePeople = allPeople.filter((p) => !memberPersonIds.has(p.id));

  async function handleAdd(e) {
    e.preventDefault();
    if (!addingPersonId) return;
    setBusy(true);
    setError("");

    const { error: insertError } = await supabase.from("committee_memberships").insert({
      person_id: addingPersonId,
      committee_id: committee.id,
      level: addingLevel,
      added_by: currentPersonId,
    });

    if (insertError) {
      console.error(insertError);
      setError("Не удалось добавить участника");
    } else {
      setAddingPersonId("");
      setAddingLevel("member");
      onChanged?.();
    }
    setBusy(false);
  }

  async function handleLevelChange(membershipId, nextLevel) {
    setBusy(true);
    setError("");
    const { error: updateError } = await supabase
      .from("committee_memberships")
      .update({ level: nextLevel })
      .eq("id", membershipId);

    if (updateError) {
      console.error(updateError);
      setError("Не удалось изменить уровень");
    } else {
      onChanged?.();
    }
    setBusy(false);
  }

  async function handleRemove(membershipId) {
    setBusy(true);
    setError("");
    const { error: deleteError } = await supabase
      .from("committee_memberships")
      .delete()
      .eq("id", membershipId);

    if (deleteError) {
      console.error(deleteError);
      setError("Не удалось удалить участника");
    } else {
      onChanged?.();
    }
    setBusy(false);
  }

  return (
    <div className="border rounded p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{committee.name}</h3>
        {committee.archived_at && (
          <span className="text-xs text-gray-400">архивирован</span>
        )}
      </div>

      <ul className="divide-y">
        {members.length === 0 && <li className="text-sm text-gray-500 py-1">Пусто</li>}
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between py-1.5 text-sm">
            <span>
              {m.people?.full_name ?? "…"}
              {m.people?.telegram_username && (
                <span className="text-gray-400"> @{m.people.telegram_username}</span>
              )}
            </span>
            {canManage ? (
              <div className="flex items-center gap-2">
                <select
                  value={m.level}
                  disabled={busy}
                  onChange={(e) => handleLevelChange(m.id, e.target.value)}
                  className="border rounded text-xs p-1"
                >
                  <option value="member">member</option>
                  <option value="lead">lead</option>
                </select>
                <button
                  disabled={busy}
                  onClick={() => handleRemove(m.id)}
                  className="text-xs text-red-600 underline"
                >
                  Удалить
                </button>
              </div>
            ) : (
              <span className="text-xs text-gray-500">{m.level}</span>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <form onSubmit={handleAdd} className="flex gap-2 items-end pt-2 border-t">
          <div className="flex-1">
            <select
              value={addingPersonId}
              onChange={(e) => setAddingPersonId(e.target.value)}
              className="w-full border rounded p-1.5 text-sm"
            >
              <option value="">— выбрать человека —</option>
              {addableePeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} {p.telegram_username ? `(@${p.telegram_username})` : ""}
                </option>
              ))}
            </select>
          </div>
          <select
            value={addingLevel}
            onChange={(e) => setAddingLevel(e.target.value)}
            className="border rounded p-1.5 text-sm"
          >
            <option value="member">member</option>
            <option value="lead">lead</option>
          </select>
          <button
            type="submit"
            disabled={busy || !addingPersonId}
            className="px-3 py-1.5 border rounded text-sm font-medium"
          >
            Добавить
          </button>
        </form>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {addableePeople.length === 0 && canManage && (
        <p className="text-xs text-gray-400">
          Все уже существующие люди состоят в этом комитете. Чтобы добавить кого-то нового —
          сначала пригласите его через форму выше и дождитесь первого входа.
        </p>
      )}
    </div>
  );
}
