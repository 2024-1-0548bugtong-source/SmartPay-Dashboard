import { useState, useCallback, useRef } from "react";
import type { CreateTransaction } from "@workspace/api-client-react/src/generated/api.schemas";

interface SerialState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
}

export function useSerial(onTransactionParsed: (tx: CreateTransaction) => void) {
  const [state, setState] = useState<SerialState>({
    isConnected: false,
    isConnecting: false,
    error: null,
  });
  
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);

  const parseLine = useCallback((line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event = "Unknown";
    let product: string | null = null;
    let paymentStatus: string | null = null;
    let weight: string | null = null;

    if (trimmed.startsWith("Entry:")) {
      event = "Entry";
    } else if (trimmed.includes("Product Removed")) {
      event = "Product Removed";
      // e.g., "Product Removed. Pay PHP5."
      const match = trimmed.match(/Pay\s+(PHP\d+)/i);
      if (match) {
        product = match[1];
        paymentStatus = "Pending";
      }
    } else if (trimmed.startsWith("Coins:")) {
      // e.g., "Coins: 5.2g - OK" or "Coins: 3.1g - INSUFFICIENT"
      const parts = trimmed.split("-").map(s => s.trim());
      weight = parts[0].replace("Coins:", "").trim();
      
      if (parts[1]?.includes("OK")) {
        event = "Payment OK";
        paymentStatus = "Verified";
      } else if (parts[1]?.includes("INSUFFICIENT")) {
        event = "Payment Incomplete";
        paymentStatus = "Insufficient";
      } else {
        event = "Payment Received";
        paymentStatus = "Pending";
      }
    } else if (trimmed.includes("Customer Left")) {
      event = "Customer Left";
    }

    const tx: CreateTransaction = {
      timestamp: new Date().toISOString(),
      event,
      product,
      paymentStatus,
      weight,
      rawLine: trimmed,
    };

    onTransactionParsed(tx);
  }, [onTransactionParsed]);

  const connect = async () => {
    if (!("serial" in navigator)) {
      setState(s => ({ ...s, error: "Web Serial API not supported in this browser." }));
      return;
    }

    setState(s => ({ ...s, isConnecting: true, error: null }));

    try {
      // @ts-ignore - Web Serial API types might not be fully available
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      portRef.current = port;

      setState({ isConnected: true, isConnecting: false, error: null });

      // Start reading loop
      // @ts-ignore
      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      readerRef.current = reader;

      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          reader.releaseLock();
          break;
        }
        if (value) {
          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop() || ""; // Keep the incomplete line
          
          for (const line of lines) {
            parseLine(line);
          }
        }
      }
    } catch (err: any) {
      setState({ isConnected: false, isConnecting: false, error: err.message || "Failed to connect" });
    }
  };

  const disconnect = async () => {
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
      }
      if (portRef.current) {
        await portRef.current.close();
      }
    } catch (err) {
      console.error("Error disconnecting", err);
    } finally {
      setState({ isConnected: false, isConnecting: false, error: null });
      portRef.current = null;
      readerRef.current = null;
    }
  };

  return {
    ...state,
    connect,
    disconnect,
  };
}
