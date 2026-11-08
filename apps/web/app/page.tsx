"use client";

import { useCallback } from "react";
import { useAccount, useReadContract } from "wagmi";
import { letheAuctionAbi } from "@lethe/shared";
import { Header } from "@/components/Header";
import { RoundRing } from "@/components/RoundRing";
import { OrderTicket } from "@/components/OrderTicket";
import { AccountPanel } from "@/components/AccountPanel";
import { MyOrders } from "@/components/MyOrders";
import { HowItWorks } from "@/components/HowItWorks";
import { Toasts } from "@/components/Toasts";
import { appConfig } from "@/lib/config";
import { useClock, useMarket, useRecentResults } from "@/lib/market";
import { useBalances } from "@/lib/balances";
import { useHelper, HELPER_TOP_UP } from "@/lib/helper";
import { useOrderEngine } from "@/lib/engine";
import { fundHelper } from "@/lib/actions";
import { friendlyError } from "@/lib/tx";
import { toast } from "@/lib/toast";

export default function Home() {
  const { address } = useAccount();
  const { market, error } = useMarket();
  const clock = useClock(market);
  const helper = useHelper();
  const { balances, refetch } = useBalances(market, address);
  const results = useRecentResults(market, clock?.round);
  const orderCount = useReadContract({
    address: market?.auction,
    abi: letheAuctionAbi,
    functionName: "orderCount",
    args: [clock?.round ?? 0n],
    query: { enabled: !!market && !!clock, refetchInterval: 1_500 },
  });

  useOrderEngine(market, clock, helper);

  const lastPrice = results.data?.filter((r) => r.settled && r.volume > 0n).at(-1)?.price;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const enableHelper = useCallback(async () => {
    if (!helper.account) return;
    try {
      await fundHelper(helper.account.address, HELPER_TOP_UP);
      helper.refetch();
      toast.push({ tone: "success", title: "Auto-reveal is on", body: "Your sealed orders will now reveal by themselves." });
    } catch (e) {
      toast.push({ tone: "error", title: "Couldn't turn on auto-reveal", body: friendlyError(e) });
    }
  }, [helper]);

  return (
    <>
      <Header />
      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
        <div className="mb-6 mt-2 max-w-2xl sm:mb-8 sm:mt-6">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Trade sealed.
            <span className="bg-gradient-to-r from-seal to-reveal bg-clip-text text-transparent"> Clear fair.</span>
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted sm:text-base">
            Lethe hides your order until the round closes, then fills everyone at one price. Bots can&apos;t see it,
            so they can&apos;t trade ahead of you.
          </p>
        </div>

        {!appConfig.ready && (
          <div className="card mb-6 border-warn/40 p-4 text-sm text-warn">
            <b>Not configured.</b> {appConfig.problems.join(" ")} Trading is disabled.
          </div>
        )}
        {appConfig.ready && error && (
          <div className="card mb-6 border-sell/40 p-4 text-sm text-sell">
            Can&apos;t read the Lethe contract on this network. Check the RPC and contract address. ({error.message.split("\n")[0]})
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="order-2 space-y-5 lg:order-1">
            <RoundRing
              market={market}
              clock={clock}
              orders={orderCount.data !== undefined ? Number(orderCount.data) : undefined}
              results={results.data}
            />
            <HowItWorks />
          </div>
          <div className="order-1 space-y-5 lg:order-2">
            <OrderTicket
              market={market}
              clock={clock}
              balances={balances}
              lastPrice={lastPrice}
              helperReady={helper.ready}
              onEnableHelper={enableHelper}
              refresh={refresh}
            />
            <MyOrders market={market} clock={clock} />
          </div>
          <div className="order-3 space-y-5">
            <AccountPanel market={market} balances={balances} helper={helper} refresh={refresh} />
          </div>
        </div>
      </main>
      <footer className="relative z-10 mx-auto max-w-6xl px-4 pb-10 text-xs text-faint sm:px-6">
        Lethe runs on Elysium testnet. Test tokens are valueless. Unaudited software, use at your own risk.
      </footer>
      <Toasts />
    </>
  );
}
