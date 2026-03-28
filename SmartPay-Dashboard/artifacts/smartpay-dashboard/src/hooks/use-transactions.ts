import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetTransactions, 
  useCreateTransaction,
  useGetTransactionStats 
} from "@workspace/api-client-react";
import type { Transaction, CreateTransaction } from "@workspace/api-client-react/src/generated/api.schemas";

export function useTransactions() {
  const queryClient = useQueryClient();
  
  const query = useGetTransactions({
    query: {
      refetchInterval: 5000, // Poll every 5s for updates from other devices
    }
  });

  const createMutation = useCreateTransaction({
    mutation: {
      onMutate: async (newTx) => {
        // Cancel any outgoing refetches so they don't overwrite our optimistic update
        await queryClient.cancelQueries({ queryKey: ["/api/transactions"] });

        // Snapshot the previous value
        const previousTxs = queryClient.getQueryData<Transaction[]>(["/api/transactions"]);

        // Optimistically update to the new value
        if (previousTxs) {
          const optimisticTx: Transaction = {
            id: Date.now(), // Temp ID
            timestamp: newTx.data.timestamp || new Date().toISOString(),
            event: newTx.data.event,
            product: newTx.data.product || null,
            paymentStatus: newTx.data.paymentStatus || null,
            weight: newTx.data.weight || null,
            rawLine: newTx.data.rawLine || null,
          };
          queryClient.setQueryData<Transaction[]>(["/api/transactions"], [optimisticTx, ...previousTxs]);
        }

        return { previousTxs };
      },
      onError: (err, newTx, context) => {
        // If the mutation fails, use the context returned from onMutate to roll back
        if (context?.previousTxs) {
          queryClient.setQueryData(["/api/transactions"], context.previousTxs);
        }
      },
      onSettled: () => {
        // Always refetch after error or success to ensure sync
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
        queryClient.invalidateQueries({ queryKey: ["/api/transactions/stats"] });
      },
    }
  });

  const statsQuery = useGetTransactionStats({
    query: {
      refetchInterval: 5000,
    }
  });

  return {
    transactions: query.data || [],
    isLoading: query.isLoading,
    addTransaction: createMutation.mutate,
    isAdding: createMutation.isPending,
    stats: statsQuery.data,
    isLoadingStats: statsQuery.isLoading
  };
}
