import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionStatus, WebSocketLogMessage } from '../types';

const MAX_MESSAGES = 1000;
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

interface UseWebSocketReturn {
  messages: WebSocketLogMessage[];
  status: ConnectionStatus;
  connect: () => void;
  disconnect: () => void;
}

export function useWebSocket(url: string | null): UseWebSocketReturn {
  const [messages, setMessages] = useState<WebSocketLogMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const clearTimer = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearTimer();
    reconnectCount.current = MAX_RECONNECT_ATTEMPTS; // prevent reconnect
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, [clearTimer]);

  const connect = useCallback(() => {
    const currentUrl = urlRef.current;
    if (!currentUrl) return;

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    reconnectCount.current = 0;
    setStatus('connecting');

    const openConnection = () => {
      const ws = new WebSocket(currentUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        reconnectCount.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WebSocketLogMessage;
          setMessages((prev) => {
            const next = [...prev, msg];
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
          });
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror
      };

      ws.onclose = () => {
        if (reconnectCount.current < MAX_RECONNECT_ATTEMPTS) {
          setStatus('reconnecting');
          reconnectCount.current += 1;
          clearTimer();
          reconnectTimer.current = setTimeout(openConnection, RECONNECT_DELAY_MS);
        } else {
          setStatus('disconnected');
        }
      };
    };

    openConnection();
  }, [clearTimer]);

  // Auto-connect when url changes
  useEffect(() => {
    if (url) {
      reconnectCount.current = 0;
      connect();
    }
    return () => {
      clearTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { messages, status, connect, disconnect };
}
