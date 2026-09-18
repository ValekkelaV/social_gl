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
// Слот бывает трёх типов (time_slots.kind, миграция 33): докладной, пленарный
// и служебный. Тип выбирается при заведении слота и потом НЕ меняется, пока в
// слоте стоит пленарный элемент, — это не UI-запрет, а внешний ключ в БД
// (см. шапку 33_slot_kinds_and_plenary.sql). Поэтому селект типа есть только
// в форме добавления: у уже созданного слота тип показан значком, а не
// выпадающим списком, который всё равно отдал бы 23503.
//
// Эксперты — внешние люди (модераторы, лекторы, участники круглых столов).
// Это НЕ пользователи админки: они не логинятся и не связаны с правами.
//
// Права здесь разъезжаются на два комитета, и это видно не сразу:
// «Расписание секций» заводит слоты и выбирает их тип, а содержимое пленарной
// части (название лекции, модератор, участники) заполняет уже «Модераторы/
// лекции/круглые столы» — тот же комитет, что и справочник экспертов. Человек
// из первого комитета увидит пленарный слот и не сможет его наполнить. Это не
// дефект, а та же развилка, что и с экспертами, но показать её надо явно:
// иначе форма отдаст 42501 без объяснений.

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
  const [plenaryItems, setPlenaryItems] = useState([]);
  const [plenaryParticipants, setPlenaryParticipants] = useState([]);
  // Организаторы — те, из кого выбирают модератора лекции. people это только
  // оргкомитет: докладчики живут в speakers и сюда не попадают.
  const [persons, setPersons] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [
      daysRes,
      slotsRes,
      expertsRes,
      sectionSlotsRes,
      assignmentsRes,
      plenaryRes,
      participantsRes,
      personsRes,
    ] = await Promise.all([
      supabase.from("conference_days").select("id, day_date, label, sort_order").order("sort_order"),
      supabase
        .from("time_slots")
        .select("id, day_id, sort_order, label, starts_at, ends_at, kind")
        .order("sort_order"),
      supabase.from("external_experts").select("*").order("full_name"),
      // Только для предупреждений при удалении: сколько докладов уедет следом.
      supabase.from("section_slots").select("id, slot_id"),
      supabase.from("talk_assignments").select("id, section_slot_id"),
      // Два внешних ключа из plenary_items ведут в разные таблицы, и каждый
      // назван в 33 явно — `!имя_ключа` обязателен для external_experts:
      // участники круглого стола (plenary_participants) связывают его с
      // plenary_items второй раз, через таблицу-связку, и без подсказки
      // PostgREST отвечает PGRST201 «more than one relationship was found».
      supabase
        .from("plenary_items")
        .select(
          "id, slot_id, format, title, description, moderator_person_id, moderator_expert_id, " +
            "people!plenary_items_moderator_person_fk(id, full_name), " +
            "external_experts!plenary_items_moderator_expert_fk(id, full_name)"
        ),
      supabase.from("plenary_participants").select("plenary_item_id, expert_id, sort_order"),
      supabase.from("people").select("id, full_name").order("full_name"),
    ]);

    const failed = [
      daysRes,
      slotsRes,
      expertsRes,
      sectionSlotsRes,
      assignmentsRes,
      plenaryRes,
      participantsRes,
      personsRes,
    ].find((r) => r.error);

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
    setPlenaryItems(plenaryRes.data ?? []);
    setPlenaryParticipants(participantsRes.data ?? []);
    setPersons(personsRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Пленарный элемент и его участники — по ключу слота: элемент в слоте ровно
  // один (unique (slot_id) в 33), поэтому карта, а не список.
  const plenaryBySlot = useMemo(() => {
    const map = new Map();
    plenaryItems.forEach((it) => map.set(it.slot_id, it));
    return map;
  }, [plenaryItems]);

  const plenaryParticipantsByItem = useMemo(() => {
    const map = new Map();
    plenaryParticipants.forEach((p) => {
      if (!map.has(p.plenary_item_id)) map.set(p.plenary_item_id, []);
      map.get(p.plenary_item_id).push(p);
    });
    map.forEach((list) => list.sort((a, b) => a.sort_order - b.sort_order));
    return map;
  }, [plenaryParticipants]);

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

  async function addSlot(dayId, label, startsAt, endsAt, kind) {
    setBusy(true);
    const daySlots = slots.filter((s) => s.day_id === dayId);
    const nextOrder = daySlots.length ? Math.max(...daySlots.map((s) => s.sort_order)) + 1 : 1;
    const { error: insertError } = await supabase.from("time_slots").insert({
      day_id: dayId,
      sort_order: nextOrder,
      label: label.trim() || null,
      starts_at: startsAt || null,
      ends_at: endsAt || null,
      kind,
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

  // ---------- ПЛЕНАРНАЯ ЧАСТЬ ----------
  // Заполняется комитетом «Модераторы/лекции/круглые столы», а не «Расписание
  // секций»: слот заводит один комитет, содержимое — другой. Отсюда общий
  // текст ошибки про права, а не про неудачу записи вообще.

  const moderatorsError = "Не удалось сохранить (нужны права комитета «Модераторы/лекции/круглые столы»)";

  async function createPlenaryItem(slotId, format, title) {
    if (!title.trim()) return;
    setBusy(true);
    // Модератор не передаётся: элемент заводят раньше, чем выбран модератор,
    // и это разрешено (в БД «не больше одного», а не «ровно один» — см. 33).
    const { error: insertError } = await supabase
      .from("plenary_items")
      .insert({ slot_id: slotId, format, title: title.trim() });
    setBusy(false);
    if (insertError) {
      console.error(insertError);
      // 23505 здесь означает не «дубль названия», а «в слоте уже есть элемент»:
      // unique (slot_id). Формулируем по-человечески, иначе сообщение о
      // нарушении уникальности читается как загадка.
      setError(
        insertError.code === "23505"
          ? "В этом слоте уже есть пленарный элемент — обновите страницу"
          : moderatorsError
      );
      return;
    }
    await load();
  }

  async function savePlenaryField(item, field, value) {
    const next = typeof value === "string" ? value.trim() || null : value;
    if (next === (item[field] ?? null)) return;
    const { error: updateError } = await supabase
      .from("plenary_items")
      .update({ [field]: next })
      .eq("id", item.id);
    if (updateError) {
      console.error(updateError);
      setError(moderatorsError);
      return;
    }
    await load();
  }

  // Модератор ровно из одного источника: ставим один, второй обязательно
  // обнуляем. Двумя отдельными update'ами тут не обойтись — между ними строка
  // побывала бы с двумя модераторами и упала на check (23514), поэтому оба
  // поля едут в одном запросе.
  async function setPlenaryModerator(item, source, value) {
    const next = value || null;
    const { error: updateError } = await supabase
      .from("plenary_items")
      .update({
        moderator_person_id: source === "person" ? next : null,
        moderator_expert_id: source === "expert" ? next : null,
      })
      .eq("id", item.id);
    if (updateError) {
      console.error(updateError);
      setError(moderatorsError);
      return;
    }
    await load();
  }

  async function addPlenaryParticipant(item, expertId) {
    if (!expertId) return;
    const taken = plenaryParticipants.filter((p) => p.plenary_item_id === item.id);
    const { error: insertError } = await supabase.from("plenary_participants").insert({
      plenary_item_id: item.id,
      expert_id: expertId,
      sort_order: taken.length + 1,
    });
    if (insertError) {
      console.error(insertError);
      // Выбор из списка уже отфильтрован, так что 23505 сюда попадает только
      // при гонке (кто-то добавил того же эксперта в другой вкладке).
      setError(insertError.code === "23505" ? "Этот эксперт уже в списке" : moderatorsError);
      return;
    }
    await load();
  }

  async function removePlenaryParticipant(item, expertId) {
    const { error: deleteError } = await supabase
      .from("plenary_participants")
      .delete()
      .eq("plenary_item_id", item.id)
      .eq("expert_id", expertId);
    if (deleteError) {
      console.error(deleteError);
      setError(moderatorsError);
      return;
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
                  <li key={slot.id} className="px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        {slot.sort_order}. {slot.label || "без названия"}
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-xs ${SLOT_KIND_CLASS[slot.kind] ?? ""}`}
                        >
                          {SLOT_KIND_LABEL[slot.kind] ?? slot.kind}
                        </span>
                        {(slot.starts_at || slot.ends_at) && (
                          <span className="text-gray-500">
                            {" "}
                            {slot.starts_at ? String(slot.starts_at).slice(0, 5) : "…"}
                            {"–"}
                            {slot.ends_at ? String(slot.ends_at).slice(0, 5) : "…"}
                          </span>
                        )}
                        {slot.kind === "talk" && (
                          <span className="text-gray-400 text-xs"> · докладов: {talksInSlot(slot.id)}</span>
                        )}
                      </div>
                      {canEditSchedule && (
                        <button onClick={() => removeSlot(slot)} className="text-xs text-gray-500 hover:text-red-600">
                          удалить
                        </button>
                      )}
                    </div>

                    {slot.kind === "plenary" && (
                      <PlenaryEditor
                        item={plenaryBySlot.get(slot.id) ?? null}
                        participants={plenaryParticipantsByItem.get(slot.id) ?? []}
                        experts={experts}
                        persons={persons}
                        canEditModerators={canEditModerators}
                        onCreate={(format, title) => createPlenaryItem(slot.id, format, title)}
                        onSaveField={savePlenaryField}
                        onSetModerator={setPlenaryModerator}
                        onAddParticipant={addPlenaryParticipant}
                        onRemoveParticipant={removePlenaryParticipant}
                      />
                    )}

                    {slot.kind === "service" && (
                      <p className="mt-1 text-xs text-gray-500">
                        Служебный слот: содержание — только подпись выше. Модераторов и экспертов у него нет.
                      </p>
                    )}
                  </li>
                ))}
              {slots.filter((s) => s.day_id === day.id).length === 0 && (
                <li className="px-3 py-2 text-xs text-gray-500">Слотов нет.</li>
              )}
            </ul>

            {canEditSchedule && (
              <AddSlotForm onAdd={(label, from, to, kind) => addSlot(day.id, label, from, to, kind)} />
            )}
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

// Значения kind/format в БД английские (как application_status и
// generated_document_type), подписи к ним — здесь. Это три объекта, а не один,
// потому что нужны они в разных местах (подпись в списке, класс значка, текст
// подсказки под селектом) и склеивать их в один — значит каждый раз разбирать.
//
// Две из них экспортируются: доска (SchedulingPage) рисует те же типы слотов и
// те же форматы, и второй такой же словарь рядом с ней разошёлся бы с этим на
// первой же правке.

export const SLOT_KIND_LABEL = {
  talk: "докладной",
  plenary: "пленарный",
  service: "служебный",
};

const SLOT_KIND_CLASS = {
  talk: "bg-gray-100 text-gray-600",
  plenary: "bg-blue-100 text-blue-700",
  service: "bg-amber-100 text-amber-700",
};

const SLOT_KIND_HINT = {
  talk: "параллельные секции с докладами — то, что распределяется на доске",
  plenary: "одно событие: лекция, круглый стол, семинар, обсуждение",
  service: "регистрация, кофебрейк, открытие/закрытие — без модераторов и экспертов",
};

export const PLENARY_FORMAT_LABEL = {
  lecture: "лекция",
  round_table: "круглый стол",
  seminar: "семинар",
  discussion: "обсуждение",
};

const PLENARY_FORMATS = Object.keys(PLENARY_FORMAT_LABEL).map((value) => ({
  value,
  label: PLENARY_FORMAT_LABEL[value],
}));

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
  const [kind, setKind] = useState("talk");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(label, from, to, kind);
        setLabel("");
        setFrom("");
        setTo("");
        // Тип НЕ сбрасываем в 'talk': слоты одного дня обычно однотипные
        // подряд (три докладных, потом кофебрейк), и сброс заставлял бы
        // выбирать его заново на каждом шаге.
      }}
      className="border-t border-dashed px-3 py-2 flex flex-wrap items-end gap-2"
    >
      <label className="text-sm">
        <span className="block text-xs text-gray-500">тип</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="border rounded p-1.5 text-sm"
        >
          {Object.keys(SLOT_KIND_LABEL).map((k) => (
            <option key={k} value={k}>
              {SLOT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
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
      <p className="w-full text-xs text-gray-500">{SLOT_KIND_HINT[kind]}</p>
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

// ============================================================
// НАПОЛНЕНИЕ ПЛЕНАРНОГО СЛОТА
// ============================================================
// Один элемент на слот (unique (slot_id) в 33), поэтому здесь нет списка
// элементов — есть либо форма «завести», либо редактор уже заведённого.
//
// Модератор — двумя селектами, а не радиокнопкой «источник» плюс один селект:
// у элемента, которому модератора ещё не выбрали, радиокнопка не выбрана ни в
// каком состоянии, и выбирать модератора было бы неоткуда. Два селекта с
// «— не выбран —» видны всегда и честно показывают, что лежит в строке.
//
// Ограничение «модератор не более одного» держит БД (check с num_nonnulls), а
// этот компонент его только не нарушает: выбор в одном селекте снимает выбор
// в другом ОДНИМ update'ом. Двумя запросами нельзя — строка между ними
// побывала бы с двумя модераторами и упала на 23514.

function PlenaryEditor({
  item,
  participants,
  experts,
  persons,
  canEditModerators,
  onCreate,
  onSaveField,
  onSetModerator,
  onAddParticipant,
  onRemoveParticipant,
}) {
  const [format, setFormat] = useState("round_table");
  const [title, setTitle] = useState("");
  const [newExpertId, setNewExpertId] = useState("");

  if (!item) {
    if (!canEditModerators) {
      return (
        <p className="mt-1 text-xs text-gray-500">
          Пленарный элемент не заведён. Заводит комитет «Модераторы/лекции/круглые столы».
        </p>
      );
    }
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          onCreate(format, title);
          setTitle("");
        }}
        className="mt-2 flex items-end gap-2"
      >
        <label className="text-sm">
          <span className="block text-xs text-gray-500">формат</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="border rounded p-1.5 text-sm"
          >
            {PLENARY_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm flex-1">
          <span className="block text-xs text-gray-500">название</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Круглый стол про…"
            className="w-full border rounded p-1.5 text-sm"
          />
        </label>
        <button type="submit" className="px-2 py-1.5 border rounded text-sm">
          Завести
        </button>
      </form>
    );
  }

  const readOnly = !canEditModerators;
  const takenExpertIds = new Set(participants.map((p) => p.expert_id));
  const freeExperts = experts.filter((ex) => !takenExpertIds.has(ex.id));

  return (
    <div className="mt-2 space-y-2 border rounded p-2 bg-gray-50">
      <div className="flex items-end gap-2">
        <label className="text-sm">
          <span className="block text-xs text-gray-500">формат</span>
          <select
            value={item.format}
            disabled={readOnly}
            onChange={(e) => onSaveField(item, "format", e.target.value)}
            className="border rounded p-1.5 text-sm disabled:bg-gray-100"
          >
            {PLENARY_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm flex-1">
          <span className="block text-xs text-gray-500">название</span>
          <input
            defaultValue={item.title ?? ""}
            disabled={readOnly}
            onBlur={(e) => onSaveField(item, "title", e.target.value)}
            className="w-full border rounded p-1.5 text-sm disabled:bg-gray-100"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="block text-xs text-gray-500">аннотация (необязательно)</span>
        <textarea
          defaultValue={item.description ?? ""}
          disabled={readOnly}
          rows={2}
          onBlur={(e) => onSaveField(item, "description", e.target.value)}
          className="w-full border rounded p-1.5 text-sm disabled:bg-gray-100"
        />
      </label>

      <div className="flex items-end gap-2">
        <label className="text-sm flex-1">
          <span className="block text-xs text-gray-500">модератор из оргкомитета</span>
          <select
            value={item.moderator_person_id ?? ""}
            disabled={readOnly}
            onChange={(e) => onSetModerator(item, "person", e.target.value)}
            className="w-full border rounded p-1.5 text-sm disabled:bg-gray-100"
          >
            <option value="">— не выбран —</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm flex-1">
          <span className="block text-xs text-gray-500">модератор — внешний эксперт</span>
          <select
            value={item.moderator_expert_id ?? ""}
            disabled={readOnly}
            onChange={(e) => onSetModerator(item, "expert", e.target.value)}
            className="w-full border rounded p-1.5 text-sm disabled:bg-gray-100"
          >
            <option value="">— не выбран —</option>
            {experts.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.full_name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-gray-500">
        Модератор ровно один: выбор в одном списке снимает выбор в другом.
      </p>

      <div>
        <span className="block text-xs text-gray-500">участники</span>
        {participants.length === 0 && <p className="text-xs text-gray-400">Пока никого.</p>}
        <ul className="divide-y border rounded bg-white">
          {participants.map((p) => {
            const ex = experts.find((x) => x.id === p.expert_id);
            return (
              <li key={p.expert_id} className="px-2 py-1 flex items-center justify-between text-sm">
                {/* Участник мог остаться от эксперта, которого потом удалили из
                    справочника: plenary_participants каскадит по expert_id, так
                    что строка бы ушла, — но проверка стоит на случай гонки с
                    другой вкладкой, где справочник обновился раньше списка. */}
                <span>{ex?.full_name ?? "— эксперт удалён —"}</span>
                {!readOnly && (
                  <button
                    onClick={() => onRemoveParticipant(item, p.expert_id)}
                    className="text-xs text-gray-500 hover:text-red-600"
                  >
                    убрать
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {!readOnly && (
          <div className="mt-1 flex items-end gap-2">
            <label className="text-sm flex-1">
              <span className="block text-xs text-gray-500">добавить участника</span>
              <select
                value={newExpertId}
                onChange={(e) => setNewExpertId(e.target.value)}
                className="w-full border rounded p-1.5 text-sm"
              >
                <option value="">— выберите эксперта —</option>
                {/* Уже добавленных из списка убираем: иначе выбор упёрся бы в
                    первичный ключ (plenary_item_id, expert_id) и отдал 23505. */}
                {freeExperts.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.full_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                onAddParticipant(item, newExpertId);
                setNewExpertId("");
              }}
              disabled={!newExpertId}
              className="px-2 py-1.5 border rounded text-sm disabled:opacity-50"
            >
              Добавить
            </button>
          </div>
        )}

        {experts.length === 0 && (
          <p className="mt-1 text-xs text-gray-500">Справочник экспертов пуст — заполните его ниже.</p>
        )}
      </div>
    </div>
  );
}
