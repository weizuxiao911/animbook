import { useCallback, useEffect, useRef, useState } from 'react';

export function useChatSessions(ai: any, ready: boolean) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionID, setSessionID] = useState<string>('');
  const sessionIDRef = useRef(sessionID);
  sessionIDRef.current = sessionID;
  const skipAutoLoad = useRef(false);

  const loadSessions = useCallback(async () => {
    if (!ai) return;
    try {
      const list = await ai.listSessions();
      setSessions(list || []);
    } catch { /* ignore */ }
  }, [ai]);

  // 启动后默认显示最近一次会话
  useEffect(() => {
    if (!ready || sessionID || skipAutoLoad.current || !ai) return;
    (async () => {
      try {
        const list = await ai.listSessions();
        setSessions(list || []);
        const last = (list || [])[0];
        if (last?.id) setSessionID(last.id);
      } catch { /* ignore */ }
    })();
  }, [ready, sessionID, ai]);

  const onNewSession = useCallback(async () => {
    if (!ai || !ready) return;
    const session = await ai.createSession();
    setSessionID(session.id);
    setSessions((prev) => [session, ...prev]);
  }, [ai, ready]);

  const onSwitchSession = useCallback((sid: string) => {
    setSessionID(sid);
    setSessions((prev) => prev.slice());
  }, []);

  const onDeleteSession = useCallback(async (sid: string) => {
    if (!ai) return;
    await ai.deleteSession(sid);
    setSessions((prev) => prev.filter((s) => s.id !== sid));
    if (sid === sessionID) setSessionID('');
  }, [ai, sessionID]);

  const onDeleteAllSessions = useCallback(async () => {
    if (!ai) return 0;
    const list = await ai.listSessions();
    let n = 0;
    for (const s of list) {
      try { await ai.deleteSession(s.id); n++; } catch { /* skip */ }
    }
    setSessions([]);
    setSessionID('');
    return n;
  }, [ai]);

  return {
    sessions, sessionID, setSessionID,
    sessionIDRef,
    loadSessions, onNewSession, onSwitchSession, onDeleteSession, onDeleteAllSessions,
    skipAutoLoad,
  };
}