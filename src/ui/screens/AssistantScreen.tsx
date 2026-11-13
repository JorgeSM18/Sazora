// Asistente: pregunta en lenguaje natural sobre la pauta y el día. La app envía los datos ya calculados,
// valida lo que vuelve y calcula ella misma las porciones y los macros de cada propuesta.

import { useMemo, useRef, useState } from 'react';
import { assistantContext, overRemaining, portionAmount, sanitizeAssistantReply, type AssistantReply } from '../../domain/assistant';
import { daySummary } from '../../domain/day';
import { recipePerServing } from '../../domain/nutrition';
import type { Recipe } from '../../domain/types';
import { useCalc, useDiet, useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { TotalsLine } from '../components/Values';
import { amountText, fmtPortion, GROUP_SHORT, todayISO } from '../format';
import { href } from '../router';

type Message = { role: 'user'; text: string } | ({ role: 'assistant'; text: string } & Partial<AssistantReply>);

const IDEAS = ['¿Qué me queda por comer hoy?', 'Propón una cena con las porciones que me quedan', '¿Qué puedo tomar en lugar de arroz?'];

async function ask(context: string, messages: Message[]): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch('/api/asistente', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context, messages: messages.map((m) => ({ role: m.role, text: m.text })) }),
    });
  } catch {
    throw new Error('No se puede conectar con el servidor.');
  }
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(body.error ?? `Error del servidor (${r.status}).`);
  return body;
}

export function AssistantScreen() {
  const { data, update } = useStore();
  const diet = useDiet();
  const ctx = useCalc();
  const date = todayISO();
  const summary = useMemo(() => daySummary(data, diet, date, ctx), [data, diet, date, ctx]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  async function send(question: string) {
    const q = question.trim();
    if (!q || sending.current) return;
    sending.current = true;
    const next: Message[] = [...messages, { role: 'user', text: q }];
    setMessages(next);
    setText('');
    setError(null);
    setBusy(true);
    try {
      const reply = sanitizeAssistantReply(await ask(assistantContext(data, diet, date, ctx), next), data, ctx, new Date().toISOString());
      setMessages([...next, { role: 'assistant', ...reply, text: reply.reply || (reply.recipes.length ? 'Aquí tienes una propuesta.' : 'No he podido responder a eso.') }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const proposal = (recipe: Recipe) => {
    const saved = data.recipes.some((r) => r.id === recipe.id);
    const perServing = recipePerServing(recipe, ctx);
    const over = overRemaining(perServing.portions, summary);
    return (
      <article className="card" key={recipe.id}>
        <h2 className="card-title">{recipe.name}</h2>
        <p className="small"><TotalsLine totals={perServing} /> <span className="muted">por ración · calculado por Sazora</span></p>
        {over.length > 0 && (
          <p className="note warn"><Icon name="aviso" size={16} /> Supera lo que te queda hoy: {over.map((o) => `${fmtPortion(o.by)} de ${GROUP_SHORT[o.group].toLowerCase()} de más`).join(', ')}.</p>
        )}
        <ul className="small">
          {recipe.ingredients.map((i, k) => {
            const food = ctx.foods.get(i.foodId!);
            const eq = portionAmount(i, ctx);
            return <li key={k}>{i.label}: {amountText(i.quantity!, i.unit!, food)}{eq ? ` (${amountText(eq.amount, eq.unit, food)})` : ''}</li>;
          })}
        </ul>
        {recipe.steps.length > 0 && <ol className="steps small">{recipe.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>}
        {saved
          ? <p className="ok-text" role="status">Guardada. <a href={href(`/recetas/${recipe.id}`)}>Abrir la receta</a></p>
          : <button className="btn small" onClick={() => update((d) => ({ ...d, recipes: [...d.recipes, recipe] }))}>Guardar en mis recetas</button>}
      </article>
    );
  };

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1>Asistente</h1>
        <p className="muted">Pregunta por tu pauta, por lo que llevas hoy o pide ideas con tus alimentos. Las porciones, calorías y macros de cada propuesta los calcula Sazora con tus datos, no la IA.</p>
      </header>

      {messages.length === 0 && (
        <div className="chips">
          {IDEAS.map((i) => <button key={i} className="btn small" disabled={busy} onClick={() => void send(i)}>{i}</button>)}
        </div>
      )}

      <div className="stack chat" aria-live="polite">
        {messages.map((m, k) => (
          <div key={k} className={`chat-msg ${m.role}`}>
            <p className="sr-only">{m.role === 'user' ? 'Tú:' : 'Asistente:'}</p>
            <p className="chat-text">{m.text}</p>
            {m.role === 'assistant' && m.recipes?.map(proposal)}
            {m.role === 'assistant' && !!m.discarded && (
              <p className="note warn"><Icon name="aviso" size={16} /> Se {m.discarded === 1 ? 'ha descartado 1 propuesta' : `han descartado ${m.discarded} propuestas`} porque usaba algo que no está en tu lista de alimentos o en una unidad sin equivalencia.</p>
            )}
          </div>
        ))}
        {busy && <p className="muted" role="status">Pensando…</p>}
        {error && <p className="note warn" role="alert"><Icon name="aviso" size={16} /> {error}</p>}
      </div>

      <form className="row chat-form" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <label className="field grow">
          <span>Tu pregunta</span>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="¿Qué puedo cenar hoy?" autoComplete="off" />
        </label>
        <button className="btn primary" type="submit" disabled={busy || !text.trim()}>Preguntar</button>
      </form>
      <p className="muted small">Con cada pregunta se envían a Gemini (Google) tu pauta, tu lista de alimentos y lo planificado y comido hoy. No sustituye a tu nutricionista.</p>
    </div>
  );
}
