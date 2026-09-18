import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthContext";

// ============================================================
// НАСТРОЙКА: ДНИ, СЛОТЫ, ВНЕШНИЕ ЭКСПЕРТЫ
// ============================================================
// Всё, что заводится один раз на конференцию, а потом только правится.
//
// Дни и слоты — это ДАННЫЕ, а не схема: точная дата конференции ещё не решена
// (см. ROADMAP, «Открытые вопросы»), поэтому в миграциях их нет и заводить их
// надо здесь. Слотов в дне по факту три, но ограничения на это в БД нет
// намеренно — расписание дня может измениться, и переписывать миграцию из-за
// этого не хочется.
//
// Эксперты — внешние люди (модераторы, лекторы, участники круглых столов).
// Это НЕ пользователи админки: они не логинятся и не связаны с правами.

export default function ScheduleSetupPage() {
  const { isOwner, memberships } = useAuth();

  const canEditSchedule = useMemo(
    () => isOwner || memberships.some((m) => m.committees?.name === "Расписание секций"),
    [isOwner, memberships]
  );
  const canEditModerators = useMemo(
    () => isOwner || memberships.some((m) => m.committees?.name === "Модераторы/лекции/круглые столы"),
    [isOwner, memberships]
  );

  const [days, setDays] = useState([]);
  const [slots, setSlots] = useState([]);
  const [experts, setExperts] = useState([]);
  const [sectionSlots, setSectionSlots] = useState([]);
  const [assignments, setAssignments] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [daysRes, slotsRes, expertsRes, sectionSlotsRes, assignmentsRes] = await Promise.all([
      supabase.from("conference_days").select("id, day_date, label, sort_order").order("sort_order"),
      supabase.from("time_slots").select("id, day_id, sort_order, label, starts_at, ends_at").order("sort_order"),
      supabase.from("external_experts").select("*").order("full_name"),
      // Только для предупреждений при удалении: сколько докладов уедет следом.
      supabase.from("section_slots").select("id, slot_id"),
      supabase.from("talk_assignments").select("id, section_slot_id"),
    ]);

    const failed = [daysRes, slotsRes, expertsRes, sectionSlotsRes, assignmentsRes].find((r) => r.error);
    if (failed) {
      console.error(failed.error);
      setError("Не удалось загрузить настройки");
      setLoading(false);
      return;
    }

    setDays(daysRes.data ?? []);
    setSlots(slotsRes.data ?? []);
    setExperts(expertsRes.data ?? []);
    setSectionSlots(sectionSlotsRes.data ?? []);
    setAssignments(assignmentsRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Сколько докладов уедет вместе со слотом — считаем по section_slots, потому
  // что talk_assignments висит на паре (секция, слот), а не на слоте напрямую.
  function talksInSlot(slotId) {
    const cellIds = new Set(sectionSlots.filter((ss) => ss.slot_id === slotId).map((ss) => ss.id));
    return assignments.filter((a) => cellIds.has(a.section_slot_id)).length;
  }

  function talksInDay(dayId) {
    return slots.filter((s) => s.day_id === dayId).reduce((sum, s) => sum + talksInSlot(s.id), 0);
  }

  // ---------- ДНИ ----------

  async function addDay(dayDate, label) {
    if (!dayDate) return;
    setBusy(true);
    const nextOrder = days.length ? Math.max(...days.map((d) => d.sort_order)) + 1 : 1;
    const { error: insertError } = await supabase
      .from("conference_days")
      .insert({ day_date: dayDate, label: label.trim() || null, sort_order: nextOrder });
    setBusy(false);
    if (insertError) {
      console.error(insertError);
      setError("Не удалось добавить день (дата не должна повторяться)");
      return;
    }
    await load();
  }

  async function removeDay(day) {
    const talks = talksInDay(day.id);
    const tail = talks ? ` Вместе с ним удалятся ${talks} доклад(ов) из расписания.` : "";
    if (!window.confirm(`Удалить «${day.label || day.day_date}»? Слоты этого дня и секции в них тоже удалятся.${tail}`))
      return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("conference_days").delete().eq("id", day.id);
    setBusy(false);
    if (deleteError) {
      console.error(deleteError);
      setError("Не удалось удалить день");
    }
    await load();
  }

  // ---------- СЛОТЫ ----------

  async function addSlot(dayId, label, startsAt, endsAt) {
    setBusy(true);
    const daySlots = slots.filter((s) => s.day_id === dayId);
    const nextOrder = daySlots.length ? Math.max(...daySlots.map((s) => s.sort_order)) + 1 : 1;
    const { error: insertError } = await supabase.from("time_slots").insert({
      day_id: dayId,
      sort_order: nextOrder,
      label: label.trim() || null,
      starts_at: startsAt || null,
      ends_at: endsAt || null,
    });
    setBusy(false);
    if (insertError) {
      console.error(insertError);
      setError("Не удалось добавить слот");
      return;
    }
    await load();
  }

  async function removeSlot(slot) {
    const talks = talksInSlot(slot.id);
    const tail = talks ? ` С ними снимутся ${talks} доклад(ов).` : "";
    if (!window.confirm(`Удалить слот «${slot.label || slot.sort_order}»? Секции, стоящие в нём, из этого слота уйдут.${tail}`))
      return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("time_slots").delete().eq("id", slot.id);
    setBusy(false);
    if (deleteError) {
      console.error(deleteError);
      setError("Не удалось удалить слот");
    }
    await load();
  }

  // ---------- ЭКСПЕРТЫ ----------

  async function addExpert(fullName) {
    if (!fullName.trim()) return;
    setBusy(true);
    const { error: insertError } = await supabase.from("external_experts").insert({ full_name: fullName.trim() });
    setBusy(false);
    if (insertError) {
      console.error(insertError);
      setError("Не удалось добавить эксперта (нужны права комитета «Модераторы/лекции/круглые столы»)");
      return;
    }
    await load();
  }

  // Поля правим по одному, на blur — как аудиторию на доске. Значения
  // сохраняются только те, что реально изменились, чтобы blur без правки не
  // дёргал базу.
  async function saveExpertField(expert, field, value) {
    const next = value.trim() || null;
    if (next === (expert[field] ?? null)) return;
    const { error: updateError } = await supabase
      .from("external_experts")
      .update({ [field]: next })
      .eq("id", expert.id);
    if (updateError) {
      console.error(updateError);
      setError("Не удалось сохранить эксперта");
      return;
    }
    await load();
  }

  async function removeExpert(expert) {
    if (
      !window.confirm(
        `Удалить «${expert.full_name}»? Если он назначен модератором в слотах, назначение тоже пропадёт.`
      )
    )
      return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("external_experts").delete().eq("id", expert.id);
    setBusy(false);
    if (deleteError) {
      console.error(deleteError);
      setError("Не удалось удалить эксперта");
    }
    await load();
  }

  if (loading) return <p className="text-sm text-gray-500">Загрузка…</p>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Дни, слоты, эксперты</h1>
        <Link to="/scheduling" className="text-sm underline">
          ← К доске распределения
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {busy && <p className="text-sm text-gray-400">Сохранение…</p>}
      {!canEditSchedule && (
        <p className="text-sm text-amber-700 border border-amber-300 rounded px-3 py-2">
          Режим просмотра: дни и слоты правит комитет «Расписание секций», экспертов — «Модераторы/лекции/
          круглые столы».
        </p>
      )}

      {/* ---------- ДНИ И СЛОТЫ ---------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Дни и слоты</h2>

        {days.length === 0 && <p className="text-sm text-gray-500">Дней пока нет.</p>}

        {days.map((day) => (
          <div key={day.id} className="border rounded">
            <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
              <div className="text-sm font-medium">
                {day.label || day.day_date}
                <span className="text-gray-500 font-normal"> · {day.day_date}</span>
              </div>
              {canEditSchedule && (
                <button onClick={() => removeDay(day)} className="text-sm text-gray-500 hover:text-red-600">
                  Удалить день
                </button>
              )}
            </div>

            <ul className="divide-y">
              {slots
                .filter((s) => s.day_id === day.id)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((slot) => (
                  <li key={slot.id} className="px-3 py-2 flex items-center justify-between text-sm">
                    <div>
                      {slot.sort_order}. {slot.label || "без названия"}
                      {(slot.starts_at || slot.ends_at) && (
                        <span className="text-gray-500">
                          {" "}
                          {slot.starts_at ? String(slot.starts_at).slice(0, 5) : "…"}
                          {"–"}
                          {slot.ends_at ? String(slot.ends_at).slice(0, 5) : "…"}
                        </span>
                      )}
                      <span className="text-gray-400 text-xs"> · докладов: {talksInSlot(slot.id)}</span>
                    </div>
                    {canEditSchedule && (
                      <button onClick={() => removeSlot(slot)} className="text-xs text-gray-500 hover:text-red-600">
                        удалить
                      </button>
                    )}
                  </li>
                ))}
              {slots.filter((s) => s.day_id === day.id).length === 0 && (
                <li className="px-3 py-2 text-xs text-gray-500">Слотов нет.</li>
              )}
            </ul>

            {canEditSchedule && <AddSlotForm onAdd={(label, from, to) => addSlot(day.id, label, from, to)} />}
          </div>
        ))}

        {canEditSchedule && <AddDayForm onAdd={addDay} />}
      </section>

      {/* ---------- ЭКСПЕРТЫ ---------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Внешние эксперты</h2>
        <p className="text-xs text-gray-500">
          Модераторы, лекторы, участники круглых столов. Это не пользователи админки — входа у них нет.
        </p>

        {experts.length === 0 && <p className="text-sm text-gray-500">Экспертов пока нет.</p>}

        {experts.map((ex) => (
          <div key={ex.id} className="border rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{ex.full_name}</div>
              {canEditModerators && (
                <button onClick={() => removeExpert(ex)} className="text-xs text-gray-500 hover:text-red-600">
                  удалить
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["affiliation", "аффилиация"],
                ["position", "должность"],
                ["email", "email"],
                ["phone", "телефон"],
                ["social", "соцсети"],
              ].map(([field, placeholder]) => (
                <input
                  key={field}
                  defaultValue={ex[field] ?? ""}
                  placeholder={placeholder}
                  disabled={!canEditModerators}
                  onBlur={(e) => saveExpertField(ex, field, e.target.value)}
                  className="border rounded p-1.5 text-sm disabled:bg-gray-100"
                />
              ))}
            </div>
          </div>
        ))}

        {canEditModerators && <AddExpertForm onAdd={addExpert} />}
      </section>
    </div>
  );
}

// ============================================================
// ФОРМЫ ДОБАВЛЕНИЯ
// ============================================================
// Инлайновые, а не window.prompt: prompt не принимает даты и не даёт показать
// подсказку, а вводить сюда надо немного.

function AddDayForm({ onAdd }) {
  const [dayDate, setDayDate] = useState("");
  const [label, setLabel] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!dayDate) return;
        onAdd(dayDate, label);
        setDayDate("");
        setLabel("");
      }}
      className="border border-dashed rounded p-3 flex items-end gap-2"
    >
      <label className="text-sm">
        <span className="block text-xs text-gray-500">дата</span>
        <input
          type="date"
          value={dayDate}
          onChange={(e) => setDayDate(e.target.value)}
          className="border rounded p-1.5 text-sm"
        />
      </label>
      <label className="text-sm flex-1">
        <span className="block text-xs text-gray-500">подпись (необязательно)</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="День 1"
          className="w-full border rounded p-1.5 text-sm"
        />
      </label>
      <button type="submit" className="px-2 py-1.5 border rounded text-sm font-semibold">
        Добавить день
      </button>
    </form>
  );
}

function AddSlotForm({ onAdd }) {
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(label, from, to);
        setLabel("");
        setFrom("");
        setTo("");
      }}
      className="border-t border-dashed px-3 py-2 flex items-end gap-2"
    >
      <label className="text-sm flex-1">
        <span className="block text-xs text-gray-500">название слота</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Утро"
          className="w-full border rounded p-1.5 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="block text-xs text-gray-500">с</span>
        <input
          type="time"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="border rounded p-1.5 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="block text-xs text-gray-500">по</span>
        <input
          type="time"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="border rounded p-1.5 text-sm"
        />
      </label>
      <button type="submit" className="px-2 py-1.5 border rounded text-sm">
        Добавить слот
      </button>
    </form>
  );
}

function AddExpertForm({ onAdd }) {
  const [fullName, setFullName] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(fullName);
        setFullName("");
      }}
      className="border border-dashed rounded p-3 flex gap-2"
    >
      <input
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="ФИО эксперта"
        className="flex-1 border rounded p-1.5 text-sm"
      />
      <button type="submit" className="px-2 py-1.5 border rounded text-sm font-semibold">
        Добавить
      </button>
    </form>
  );
}
