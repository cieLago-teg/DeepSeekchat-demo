import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import type { AgentTask } from '../../services/chat/agent.js'
import { completeDemoSearch } from '../../services/chat/store.js'
import './agentProgress.css'
import userStyles from './UserMessage.module.css'

const phases: Record<AgentTask['phase'], TranslationKey> = {
  planning: 'agentPlanning',
  searching: 'agentSearching',
  answering: 'agentAnswering',
  done: 'agentDone',
  stopped: 'agentStopped',
  error: 'agentError',
}

export const AgentProgress = ({ task, sessionId }: { task: AgentTask; sessionId: string }) => {
  const t = useTranslate()
  return (
    <section className="agent-progress" aria-label={t('agentProgress')}>
      <div role="status" aria-live="polite">
        <strong>{t(phases[task.phase])}</strong>
        {task.demo ? <span className="agent-badge">{t('agentDemo')}</span> : null}
        <span className="agent-call-count">
          {t('agentCalls', { count: task.calls, limit: task.callLimit ?? 8 })}
        </span>
      </div>
      {task.steps.map((step) => (
        <details key={step.id} open={step.status === 'searching'}>
          <summary>
            {t(
              step.status === 'searching'
                ? 'agentSearching'
                : step.status === 'done'
                  ? 'agentSearchDone'
                  : step.status === 'stopped'
                    ? 'agentStopped'
                    : 'agentSearchError'
            )}{' '}
            · {step.query}
          </summary>
          {step.domains.length ? (
            <p>
              {t('agentDomains')}: {step.domains.join(', ')}
            </p>
          ) : null}
          {step.error ? <p>{step.error}</p> : null}
          <ul>
            {step.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {task.steers.map((steer) => (
        <div key={steer.id} className="agent-steer" data-steer-status={steer.status} role="status">
          <strong>
            {t(
              steer.status === 'received'
                ? 'agentReceived'
                : steer.status === 'applied'
                  ? 'agentApplied'
                  : 'agentUnapplied',
              { call: steer.call ?? 0 }
            )}
          </strong>
          <div className="agent-user-message">
            <div className={userStyles.bubble}>{steer.text}</div>
          </div>
          {steer.reply ? (
            <div className="agent-dialogue" data-dialogue-status={steer.reply.status}>
              <strong>{t('agentDialogueReply')}</strong>
              <div>
                {steer.reply.text ||
                  t(
                    steer.reply.status === 'stopped'
                      ? 'agentDialogueStopped'
                      : 'agentDialoguePending'
                  )}
              </div>
              {steer.reply.error ? <div role="alert">{steer.reply.error}</div> : null}
            </div>
          ) : null}
        </div>
      ))}
      {task.demo && task.phase === 'searching' ? (
        <button type="button" onClick={() => completeDemoSearch(sessionId)}>
          {t('agentReleaseSearch')}
        </button>
      ) : null}
    </section>
  )
}
