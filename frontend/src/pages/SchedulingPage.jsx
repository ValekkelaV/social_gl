import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthContext";
import ScheduleSetupPage from "./ScheduleSetupPage";

// ============================================================
// РАЗДЕЛ «СЕКЦИИ И РАСПИСАНИЕ»
// ============================================================
// Два экрана: доска распределения (index) и настройка дней/слотов/экспертов
// (setup).
//
// Почему перетаскивание нативное (HTML5 DnD), а не через библиотеку. В проекте
// нет ни одной UI-зависимости, кроме react и router; dnd-kit или
// react-beautiful-dnd — это новая зависимость в бандл и в обслуживание ради
// одного экрана. Нативный API покрывает ровно то, что нужно: перетащить
// карточку в колонку и переставить внутри колонки.
//
// Главная ловушка нативного DnD, из-за которой код ниже выглядит странно:
// dataTransfer.getData() в обработчике dragover НЕДОСТУПЕН — браузер отдаёт
// только список типов, но не значения (так устроен API: иначе страница могла бы
// подсмотреть содержимое чужого перетаскивания). Поэтому тащимый доклад мы
// помним в useRef, а dataTransfer заполняем только чтобы браузер вообще начал
// перетаскивание.

export default function SchedulingPage() {
  return (
    <Routes>
      <Route index element={<ScheduleBoard />} />
      <Route path="setup" element={<ScheduleSetupPage />} />
    </Routes>
  );
}

// ============================================================
// ДОСКА: ПУЛ ЗАЯВОК СЛЕВА, РАСПИСАНИЕ СПРАВА
// ============================================================

function ScheduleBoard() {
  const { isOwner, memberships } = useAuth();

  // Права в UI должны повторять RLS-помощники, а не додумывать их.
  // is_schedule_committee_member (08_scheduling_rls.sql) смотрит ТОЛЬКО имя
  // комитета и не проверяет level — в отличие от is_selection_committee_lead.
  // Добавить сюда `m.level === "lead"` значило бы спрятать от человека кнопки,
  // на которые RLS его пускает: он бы видел раздел и не мог в нём ничего.
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
  const [sectionSlots, setSectionSlots] = useState([]);
  const [dayNumbers, setDayNumbers] = useState([]);
  const [experts, setExperts] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [applications, setApplications] = useState([]);
  const [displayIds, setDisplayIds] = useState({});
  const [warnings, setWarnings] = useState({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [activeDayId, setActiveDayId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("accepted");
  const [query, setQuery] = useState("");

  // Куда встанет перетаскиваемое: { sectionSlotId, index }.
  const [dragOver, setDragOver] = useState(null);
  // Что тащим. Именно ref, а не state: значение нужно в момент drop, а
  // перерисовка на каждый dragover и так идёт.
  const dragged = useRef(null);

  // ============================================================
  // ЗАГРУЗКА
  // ============================================================
  // Грузим весь раздел целиком, а не по ячейке на запрос: на всю конференцию
  // это сотни строк (2 дня, 6 слотов, ~12 секций, ~60 докладов), зато
  // перетаскивание не ждёт сети и не мигает. silent=true — перезагрузка после
  // правки, чтобы не показывать «Загрузка…» поверх уже отрисованной доски.

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");

    const [daysRes, slotsRes, sectionSlotsRes, numbersRes, expertsRes, assignmentsRes, appsRes, idsRes, warnRes] =
      await Promise.all([
        supabase.from("conference_days").select("id, day_date, label, sort_order").order("sort_order"),
        supabase.from("time_slots").select("id, day_id, sort_order, label, starts_at, ends_at").order("sort_order"),
        supabase
          .from("section_slots")
          .select(
            "id, section_id, slot_id, room, sections(id, name), section_slot_moderators(expert_id, external_experts(id, full_name))"
          ),
        supabase.from("section_day_numbers").select("section_id, day_id, section_number"),
        supabase.from("external_experts").select("id, full_name, affiliation").order("full_name"),
        supabase
          .from("talk_assignments")
          .select(
            "id, application_id, section_slot_id, talk_number, applications(id, title, status, speakers(full_name, sort_order))"
          ),
        supabase
          .from("applications")
          .select("id, title, proposed_topic, status, desired_section, speakers(full_name, sort_order)"),
        supabase.from("talk_display_ids").select("talk_assignment_id, display_id"),
        supabase.from("slot_capacity_warnings").select("section_slot_id, talks_count"),
      ]);

    const failed = [
      daysRes,
      slotsRes,
      sectionSlotsRes,
      numbersRes,
      expertsRes,
      assignmentsRes,
      appsRes,
      idsRes,
      warnRes,
    ].find((r) => r.error);

    if (failed) {
      console.error(failed.error);
      setError("Не удалось загрузить расписание");
      setLoading(false);
      return;
    }

    setDays(daysRes.data ?? []);
    setSlots(slotsRes.data ?? []);
    setSectionSlots(sectionSlotsRes.data ?? []);
    setDayNumbers(numbersRes.data ?? []);
    setExperts(expertsRes.data ?? []);
    setAssignments(assignmentsRes.data ?? []);
    setApplications(appsRes.data ?? []);

    const idMap = {};
    (idsRes.data ?? []).forEach((r) => (idMap[r.talk_assignment_id] = r.display_id));
    setDisplayIds(idMap);

    // Предупреждение о вместимости берём из вьюхи, а не считаем сами: порог
    // (> 6) живёт в SQL, и если его поменяют там, UI поменяется вместе с ним.
    // Счётчик «5 / 6» при этом считаем локально — он просто про уже
    // загруженные данные.
    const warnMap = {};
    (warnRes.data ?? []).forEach((r) => (warnMap[r.section_slot_id] = r.talks_count));
    setWarnings(warnMap);

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!activeDayId && days.length > 0) setActiveDayId(days[0].id);
  }, [days, activeDayId]);

  // ============================================================
  // ПРОИЗВОДНЫЕ ДАННЫЕ
  // ============================================================

  const dayById = useMemo(() => new Map(days.map((d) => [d.id, d])), [days]);

  const sectionBySectionSlot = useMemo(() => {
    const map = new Map();
    sectionSlots.forEach((ss) => map.set(ss.id, ss.sections));
    return map;
  }, [sectionSlots]);

  // Номер секции — свойство пары (секция, день), поэтому ключ составной.
  const numberBySectionDay = useMemo(() => {
    const map = new Map();
    dayNumbers.forEach((n) => map.set(`${n.section_id}:${n.day_id}`, n.section_number));
    return map;
  }, [dayNumbers]);

  const talksByCell = useMemo(() => {
    const map = new Map();
    assignments.forEach((a) => {
      if (!map.has(a.section_slot_id)) map.set(a.section_slot_id, []);
      map.get(a.section_slot_id).push(a);
    });
    map.forEach((list) => list.sort((x, y) => x.talk_number - y.talk_number));
    return map;
  }, [assignments]);

  const assignedApplicationIds = useMemo(
    () => new Set(assignments.map((a) => a.application_id)),
    [assignments]
  );

  const activeDay = activeDayId ? dayById.get(activeDayId) : null;
  const activeDaySlots = useMemo(
    () => slots.filter((s) => s.day_id === activeDayId).sort((a, b) => a.sort_order - b.sort_order),
    [slots, activeDayId]
  );

  // Колонки слота: параллельные секции, в порядке номера в этом дне.
  // Без номера — в конец (такие видно по «нет номера в дне»).
  const columnsBySlot = useMemo(() => {
    const map = new Map();
    sectionSlots.forEach((ss) => {
      if (!map.has(ss.slot_id)) map.set(ss.slot_id, []);
      map.get(ss.slot_id).push(ss);
    });
    map.forEach((list) =>
      list.sort((a, b) => {
        const na = numberBySectionDay.get(`${a.section_id}:${activeDayId}`);
        const nb = numberBySectionDay.get(`${b.section_id}:${activeDayId}`);
        if (na == null && nb == null) return (a.sections?.name ?? "").localeCompare(b.sections?.name ?? "", "ru");
        if (na == null) return 1;
        if (nb == null) return -1;
        return na - nb;
      })
    );
    return map;
  }, [sectionSlots, numberBySectionDay, activeDayId]);

  const pool = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applications
      .filter((a) => !assignedApplicationIds.has(a.id))
      .filter((a) => statusFilter === "all" || a.status === statusFilter)
      .filter((a) => {
        if (!q) return true;
        const names = (a.speakers ?? []).map((s) => s.full_name).join(" ");
        return `${a.title ?? ""} ${a.proposed_topic ?? ""} ${names}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", "ru"));
  }, [applications, assignedApplicationIds, statusFilter, query]);

  // Переполнение разрядов: ID склеивается как день-слот-секция-номер без
  // разделителей, поэтому при >=10 секций в дне или >=10 докладов в паре
  // разные доклады получают один и тот же ID. БД это не запрещает намеренно
  // (см. шапку 31_schedule_capacity_ids), но организатору надо сказать.
  const digitOverflow = useMemo(() => {
    const manySections = dayNumbers.some(
      (n) => n.day_id === activeDayId && n.section_number >= 10
    );
    const manyTalks = assignments.some((a) => a.talk_number >= 10);
    return manySections || manyTalks;
  }, [dayNumbers, assignments, activeDayId]);

  // ============================================================
  // ПЕРЕТАСКИВАНИЕ
  // ============================================================

  function onDragStart(e, applicationId, fromSectionSlotId) {
    dragged.current = { applicationId, fromSectionSlotId: fromSectionSlotId ?? null };
    // Значение сюда класть бессмысленно (в dragover его не прочитать), но
    // какой-то setData нужен: без него часть браузеров не начинает drag.
    e.dataTransfer.setData("text/plain", applicationId);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragEnd() {
    dragged.current = null;
    setDragOver(null);
  }

  // Позиция вставки считалась по отрисованному списку, а доклад из этого же
  // списка мы сначала вынимаем — поэтому индекс после его позиции сдвигается
  // на единицу. Без этой поправки перетаскивание вниз внутри своей же колонки
  // вставляло бы доклад на место через одного.
  function orderedIdsWith(list, movingId, indexInRendered) {
    const fromIndex = list.indexOf(movingId);
    const without = list.filter((id) => id !== movingId);
    const pos = fromIndex >= 0 && fromIndex < indexInRendered ? indexInRendered - 1 : indexInRendered;
    const result = [...without];
    result.splice(Math.max(0, Math.min(pos, result.length)), 0, movingId);
    return result;
  }

  async function applyMove(applicationId, toSectionSlotId, indexInRendered) {
    const moving = assignments.find((a) => a.application_id === applicationId);
    // Доклада может не быть среди назначений, и это не ошибка, а самый частый
    // случай: тащат из пула, то есть доклад только сейчас попадает в
    // расписание. Здесь стояло `if (!moving) return` — и перетаскивание из пула
    // молча не делало ровно ничего, потому что «вернуть доклад из пула» и
    // «доклад ещё не распределён» — разные состояния. Источник тогда пуст,
    // а номер reorder_talks назначит по позиции в списке.
    const fromCellId = moving?.section_slot_id ?? null;
    if (fromCellId === toSectionSlotId && indexInRendered == null) return;

    // Оптимистично переставляем локально, чтобы карточка не «отпрыгнула»
    // обратно до ответа сервера; номера поправит перезагрузка. Доклад из пула
    // тут никуда не переезжает — строки в assignments у него ещё нет, — но
    // перезагрузка ниже отработает раньше, чем это успеет быть заметно.
    if (fromCellId) {
      setAssignments((prev) =>
        prev.map((a) =>
          a.application_id === applicationId ? { ...a, section_slot_id: toSectionSlotId } : a
        )
      );
    }

    // Список ячейки как она отрисована. Если доклад уже здесь, orderedIdsWith
    // сначала вынет его и поправит индекс; если он из другой ячейки — просто
    // вставит на место. Дописывать его в конец списка не надо: тогда поправка
    // индекса сработала бы на нём как на «уже отрисованном» и сдвинула бы
    // вставку на позицию назад.
    const targetOrder = orderedIdsWith(
      (talksByCell.get(toSectionSlotId) ?? []).map((a) => a.application_id),
      applicationId,
      indexInRendered ?? Number.MAX_SAFE_INTEGER
    );

    const calls = [supabase.rpc("reorder_talks", { p_section_slot_id: toSectionSlotId, p_application_ids: targetOrder })];

    // Ячейку-источник пересобираем отдельным вызовом той же функции: у неё
    // теперь дырка в номерах там, откуда доклад уехал. Так обе ячейки правит
    // одна операция, а не два разных пути.
    if (fromCellId && fromCellId !== toSectionSlotId) {
      const sourceOrder = (talksByCell.get(fromCellId) ?? [])
        .map((a) => a.application_id)
        .filter((id) => id !== applicationId);
      calls.push(
        supabase.rpc("reorder_talks", { p_section_slot_id: fromCellId, p_application_ids: sourceOrder })
      );
    }

    setBusy(true);
    const results = await Promise.all(calls);
    setBusy(false);

    const failed = results.find((r) => r.error);
    if (failed) {
      console.error(failed.error);
      setError("Не удалось передвинуть доклад — вернул как было");
    }
    await load({ silent: true });
  }

  async function unassign(applicationId, cellId) {
    const sourceOrder = (talksByCell.get(cellId) ?? [])
      .map((a) => a.application_id)
      .filter((id) => id !== applicationId);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("reorder_talks", {
      p_section_slot_id: cellId,
      p_application_ids: sourceOrder,
    });
    setBusy(false);
    if (rpcError) {
      console.error(rpcError);
      setError("Не удалось снять доклад");
    }
    await load({ silent: true });
  }

  // ============================================================
  // ПРАВКИ СЕКЦИЙ, АУДИТОРИЙ, МОДЕРАТОРОВ
  // ============================================================

  async function createSection(slotId, name, number) {
    setBusy(true);
    setError("");

    const { data: section, error: sectionError } = await supabase
      .from("sections")
      .insert({ name: name.trim() })
      .select("id")
      .single();

    if (sectionError) {
      console.error(sectionError);
      setError("Не удалось создать секцию");
      setBusy(false);
      return;
    }

    const { error: slotError } = await supabase
      .from("section_slots")
      .insert({ section_id: section.id, slot_id: slotId });

    if (slotError) {
      console.error(slotError);
      setError("Не удалось поставить секцию в слот");
      setBusy(false);
      return;
    }

    // Номер секции уникален в рамках дня, поэтому вставка может отбиться — и
    // это единственный шаг, который может отбиться уже после того, как секция
    // создана. Убираем огрызок: секция без номера в дне не сломала бы ничего
    // (в talk_display_ids такой доклад виден как display_id = NULL), но
    // оставлять её в списке — мусор, который никто не поймёт.
    const { error: numberError } = await supabase.from("section_day_numbers").insert({
      section_id: section.id,
      day_id: activeDayId,
      section_number: number,
    });

    if (numberError) {
      console.error(numberError);
      await supabase.from("sections").delete().eq("id", section.id);
      setError(`Номер ${number} в этом дне уже занят`);
      setBusy(false);
      return;
    }

    setBusy(false);
    await load({ silent: true });
  }

  // Секции А, Б, В идут все три слота дня параллельно, поэтому «поставить в
  // остальные слоты» — действие на каждый день, а не редкость. Аудиторию не
  // копируем: она как раз может отличаться от слота к слоту, ради этого и
  // хранится на паре, а не на секции.
  async function duplicateToOtherSlots(sectionId, slotId) {
    const otherSlots = activeDaySlots
      .filter((s) => s.id !== slotId)
      .filter((s) => !sectionSlots.some((ss) => ss.section_id === sectionId && ss.slot_id === s.id));
    if (otherSlots.length === 0) return;
    setBusy(true);
    const { error: insertError } = await supabase
      .from("section_slots")
      .insert(otherSlots.map((s) => ({ section_id: sectionId, slot_id: s.id })));
    setBusy(false);
    if (insertError) {
      console.error(insertError);
      setError("Не удалось поставить секцию в остальные слоты");
    }
    await load({ silent: true });
  }

  async function saveRoom(sectionSlotId, room) {
    const { error: updateError } = await supabase
      .from("section_slots")
      .update({ room: room.trim() || null })
      .eq("id", sectionSlotId);
    if (updateError) {
      console.error(updateError);
      setError("Не удалось сохранить аудиторию");
      return;
    }
    await load({ silent: true });
  }

  async function saveModerator(sectionSlotId, expertId) {
    setBusy(true);
    const { error: modError } = expertId
      ? await supabase
          .from("section_slot_moderators")
          .upsert({ section_slot_id: sectionSlotId, expert_id: expertId }, { onConflict: "section_slot_id" })
      : await supabase.from("section_slot_moderators").delete().eq("section_slot_id", sectionSlotId);
    setBusy(false);
    if (modError) {
      console.error(modError);
      setError("Не удалось сохранить модератора (нужны права комитета «Модераторы/лекции/круглые столы»)");
      return;
    }
    await load({ silent: true });
  }

  async function removeSectionFromSlot(sectionSlot) {
    const talks = talksByCell.get(sectionSlot.id) ?? [];
    const name = sectionSlot.sections?.name ?? "секцию";
    const tail = talks.length
      ? ` Доклады (${talks.length}) снимутся с расписания и вернутся в список нераспределённых.`
      : "";
    if (!window.confirm(`Убрать «${name}» из этого слота?${tail}`)) return;
    setBusy(true);
    // Удаление section_slots каскадом уносит talk_assignments — именно поэтому
    // предупреждение выше говорит про доклады, а не только про секцию.
    const { error: deleteError } = await supabase.from("section_slots").delete().eq("id", sectionSlot.id);
    setBusy(false);
    if (deleteError) {
      console.error(deleteError);
      setError("Не удалось убрать секцию из слота");
    }
    await load({ silent: true });
  }

  // ============================================================
  // ОТРИСОВКА
  // ============================================================

  if (loading) return <p className="text-sm text-gray-500">Загрузка…</p>;

  const noDays = days.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Секции и расписание</h1>
        <div className="flex items-center gap-4 text-sm">
          {busy && <span className="text-gray-400">Сохранение…</span>}
          <Link to="/scheduling/setup" className="underline">
            Дни, слоты, эксперты →
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!canEditSchedule && (
        <p className="text-sm text-amber-700 border border-amber-300 rounded px-3 py-2">
          Режим просмотра: распределять доклады может комитет «Расписание секций». Всё видно, менять —
          нельзя.
        </p>
      )}

      {noDays ? (
        <p className="text-sm text-gray-500">
          Дни конференции ещё не заведены — сначала{" "}
          <Link to="/scheduling/setup" className="underline">
            настройка
          </Link>
          .
        </p>
      ) : (
        <>
          {digitOverflow && (
            <p className="text-sm text-red-700 border border-red-300 rounded px-3 py-2">
              В дне больше девяти секций или в паре больше девяти докладов — ID докладов перестают быть
              однозначными (они склеены без разделителей). Проверить совпадения: запрос
              <span className="font-mono"> find_display_id_collisions.sql</span>.
            </p>
          )}

          <div className="flex gap-2 text-sm flex-wrap">
            {days.map((d) => (
              <button
                key={d.id}
                onClick={() => setActiveDayId(d.id)}
                className={activeDayId === d.id ? "px-2 py-1 border rounded font-semibold" : "px-2 py-1 border rounded text-gray-600"}
              >
                {d.label || d.day_date}
              </button>
            ))}
          </div>

          <div className="flex gap-4 items-start">
            {/* ---------- ПУЛ ---------- */}
            <div
              className="w-80 shrink-0 border rounded"
              onDragOver={(e) => {
                // Дроп сюда = снять доклад с расписания.
                if (canEditSchedule && dragged.current?.fromSectionSlotId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const drag = dragged.current;
                dragged.current = null;
                setDragOver(null);
                if (drag?.fromSectionSlotId) unassign(drag.applicationId, drag.fromSectionSlotId);
              }}
            >
              <div className="px-3 py-2 border-b bg-gray-50">
                <div className="text-sm font-semibold">Не распределены ({pool.length})</div>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Поиск по докладу или докладчику"
                  className="mt-2 w-full border rounded p-1.5 text-sm"
                />
                <div className="flex gap-1 mt-2 text-xs">
                  {[
                    ["accepted", "Принятые"],
                    ["needs_revision", "На доработке"],
                    ["all", "Все"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setStatusFilter(value)}
                      className={statusFilter === value ? "px-2 py-1 border rounded font-semibold" : "px-2 py-1 border rounded text-gray-600"}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <ul className="divide-y max-h-[70vh] overflow-y-auto">
                {pool.length === 0 && (
                  <li className="px-3 py-2 text-xs text-gray-500">Пусто — всё распределено.</li>
                )}
                {pool.map((a) => (
                  <li key={a.id}>
                    <div
                      draggable={canEditSchedule}
                      onDragStart={(e) => onDragStart(e, a.id, null)}
                      onDragEnd={onDragEnd}
                      className={`px-3 py-2 hover:bg-gray-50 ${canEditSchedule ? "cursor-grab" : ""}`}
                    >
                      <div className="text-sm">{a.title || a.proposed_topic || "Без названия"}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {(a.speakers ?? [])
                          .slice()
                          .sort((x, y) => x.sort_order - y.sort_order)
                          .map((s) => s.full_name)
                          .join("; ") || "—"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* ---------- РАСПИСАНИЕ ДНЯ ---------- */}
            <div className="flex-1 space-y-4 min-w-0">
              {activeDaySlots.length === 0 && (
                <p className="text-sm text-gray-500">
                  У этого дня нет слотов —{" "}
                  <Link to="/scheduling/setup" className="underline">
                    настроить
                  </Link>
                  .
                </p>
              )}

              {activeDaySlots.map((slot) => {
                const columns = columnsBySlot.get(slot.id) ?? [];
                return (
                  <div key={slot.id} className="border rounded">
                    <div className="px-3 py-2 border-b bg-gray-50 text-sm font-semibold">
                      {slot.label || `Слот ${slot.sort_order}`}
                      {slot.starts_at && (
                        <span className="text-gray-500 font-normal">
                          {" "}
                          {String(slot.starts_at).slice(0, 5)}
                          {slot.ends_at ? `–${String(slot.ends_at).slice(0, 5)}` : ""}
                        </span>
                      )}
                    </div>

                    <div className="flex gap-3 p-3 items-start overflow-x-auto">
                      {columns.map((ss) => (
                        <SectionColumn
                          key={ss.id}
                          sectionSlot={ss}
                          sectionNumber={numberBySectionDay.get(`${ss.section_id}:${activeDayId}`)}
                          talks={talksByCell.get(ss.id) ?? []}
                          displayIds={displayIds}
                          warningCount={warnings[ss.id]}
                          experts={experts}
                          canEditSchedule={canEditSchedule}
                          canEditModerators={canEditModerators}
                          dragOver={dragOver}
                          setDragOver={setDragOver}
                          dragged={dragged}
                          onDragStart={onDragStart}
                          onDragEnd={onDragEnd}
                          onDropTalk={applyMove}
                          onSaveRoom={saveRoom}
                          onSaveModerator={saveModerator}
                          onRemove={removeSectionFromSlot}
                          onDuplicate={() => duplicateToOtherSlots(ss.section_id, ss.slot_id)}
                          hasOtherSlots={activeDaySlots.some(
                            (s) => s.id !== ss.slot_id && !sectionSlots.some((x) => x.section_id === ss.section_id && x.slot_id === s.id)
                          )}
                        />
                      ))}

                      {canEditSchedule && <NewSection onCreate={(name, number) => createSection(slot.id, name, number)} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// КОЛОНКА СЕКЦИИ В СЛОТЕ
// ============================================================
// Пара (секция, слот) — это и есть единица расписания: аудитория и модератор
// свои на каждый слот, и вместимость считается на неё же.

function SectionColumn({
  sectionSlot,
  sectionNumber,
  talks,
  displayIds,
  warningCount,
  experts,
  canEditSchedule,
  canEditModerators,
  dragOver,
  setDragOver,
  dragged,
  onDragStart,
  onDragEnd,
  onDropTalk,
  onSaveRoom,
  onSaveModerator,
  onRemove,
  onDuplicate,
  hasOtherSlots,
}) {
  const section = sectionSlot.sections;
  // PostgREST отдаёт связь «к одному» объектом, а «ко многим» — массивом.
  // У section_slot_moderators первичный ключ и есть внешний (модератор строго
  // один на пару), поэтому приходит объект, а не массив из одной строки.
  // Читать его как массив (?.section_slot_moderators[0]) — значит молча
  // никогда не увидеть модератора и не подставить его в селект.
  const moderatorLink = Array.isArray(sectionSlot.section_slot_moderators)
    ? sectionSlot.section_slot_moderators[0]
    : sectionSlot.section_slot_moderators;
  const moderator = moderatorLink?.external_experts;
  const over = dragOver?.sectionSlotId === sectionSlot.id ? dragOver.index : null;

  return (
    <div
      className="w-64 shrink-0 border rounded flex flex-col"
      onDragOver={(e) => {
        if (!canEditSchedule || !dragged.current) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        // Пустое место колонки — вставка в конец. Карточки перехватывают
        // событие сами (stopPropagation), поэтому сюда долетает только оно.
        setDragOver({ sectionSlotId: sectionSlot.id, index: talks.length });
      }}
      onDrop={(e) => {
        e.preventDefault();
        const drag = dragged.current;
        const to = dragOver?.sectionSlotId === sectionSlot.id ? dragOver.index : talks.length;
        dragged.current = null;
        setDragOver(null);
        if (drag) onDropTalk(drag.applicationId, sectionSlot.id, to);
      }}
    >
      <div className="px-2 py-2 border-b bg-gray-50 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-medium">
            {sectionNumber != null && <span className="text-gray-500">{sectionNumber}. </span>}
            {section?.name ?? "—"}
          </div>
          {canEditSchedule && (
            <div className="flex gap-1 shrink-0">
              {hasOtherSlots && (
                <button
                  onClick={onDuplicate}
                  title="Поставить секцию в остальные слоты этого дня"
                  className="text-xs text-gray-500 hover:text-gray-800"
                >
                  +слоты
                </button>
              )}
              <button onClick={onRemove} title="Убрать из слота" className="text-xs text-gray-500 hover:text-red-600">
                ×
              </button>
            </div>
          )}
        </div>

        {sectionNumber == null && (
          <div className="text-xs text-amber-600">нет номера в дне — ID докладов пустые</div>
        )}

        {canEditSchedule ? (
          <input
            defaultValue={sectionSlot.room ?? ""}
            onBlur={(e) => {
              if ((e.target.value ?? "").trim() !== (sectionSlot.room ?? "")) onSaveRoom(sectionSlot.id, e.target.value);
            }}
            placeholder="аудитория"
            className="w-full border rounded p-1 text-xs"
          />
        ) : (
          <div className="text-xs text-gray-500">{sectionSlot.room || "аудитория не указана"}</div>
        )}

        <select
          value={moderator?.id ?? ""}
          disabled={!canEditModerators}
          onChange={(e) => onSaveModerator(sectionSlot.id, e.target.value || null)}
          className="w-full border rounded p-1 text-xs disabled:bg-gray-100"
        >
          <option value="">{moderator ? "— снять модератора —" : "модератор не назначен"}</option>
          {experts.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.full_name}
            </option>
          ))}
        </select>

        <div className={`text-xs ${warningCount ? "text-amber-700 font-semibold" : "text-gray-400"}`}>
          {talks.length} / 6 докладов{warningCount ? " ⚠ больше нормы" : ""}
        </div>
      </div>

      <ul className="p-2 space-y-1 min-h-[40px]">
        {over === 0 && <li className="h-0.5 bg-blue-500 rounded" />}
        {talks.map((talk, index) => (
          <li key={talk.id}>
            <div className={dragged.current?.applicationId === talk.application_id ? "opacity-40" : ""}>
              <div
                draggable={canEditSchedule}
                onDragStart={(e) => onDragStart(e, talk.application_id, sectionSlot.id)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => {
                  if (!canEditSchedule || !dragged.current) return;
                  e.preventDefault();
                  // stopPropagation обязателен: иначе событие долетит до
                  // колонки, и она перезапишет позицию вставки на «в конец».
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > r.top + r.height / 2;
                  setDragOver({ sectionSlotId: sectionSlot.id, index: index + (after ? 1 : 0) });
                }}
                className={`border rounded px-2 py-1.5 bg-white ${canEditSchedule ? "cursor-grab" : ""}`}
              >
                <div className="text-xs text-gray-400 font-mono">
                  {displayIds[talk.id] ?? "—"}
                </div>
                <div className="text-sm leading-snug">
                  {talk.applications?.title || talk.applications?.proposed_topic || "Без названия"}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {(talk.applications?.speakers ?? [])
                    .slice()
                    .sort((x, y) => x.sort_order - y.sort_order)
                    .map((s) => s.full_name)
                    .join("; ") || "—"}
                </div>
              </div>
            </div>
            {over === index + 1 && <div className="h-0.5 bg-blue-500 rounded mt-1" />}
          </li>
        ))}
        {talks.length === 0 && over === null && (
          <li className="text-xs text-gray-400 px-1 py-2">перетащите доклад сюда</li>
        )}
      </ul>
    </div>
  );
}

// ============================================================
// СОЗДАНИЕ СЕКЦИИ ПРЯМО В СЛОТЕ
// ============================================================
// Отдельного экрана «создать секцию» нет намеренно: секция рождается в момент,
// когда доклады впервые складывают в неё, и номер в дне осмысленен только
// вместе со слотом, куда её ставят.

function NewSection({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-40 shrink-0 border border-dashed rounded px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
      >
        + секция
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(number);
        if (!name.trim() || !Number.isInteger(n) || n < 1) return;
        onCreate(name, n);
        setName("");
        setNumber("");
        setOpen(false);
      }}
      className="w-64 shrink-0 border rounded p-2 space-y-1"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="название секции"
        className="w-full border rounded p-1.5 text-sm"
      />
      <input
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="номер в дне"
        inputMode="numeric"
        className="w-full border rounded p-1.5 text-sm"
      />
      <div className="flex gap-2">
        <button type="submit" className="px-2 py-1 border rounded text-sm font-semibold">
          Создать
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-sm text-gray-500">
          Отмена
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Номер сквозной в рамках дня: если секция идёт несколько слотов, он один и тот же.
      </p>
    </form>
  );
}
