"use client";
import { useControlAction } from "@/hooks/use-control-action";
import type { ControlTab } from "./control-types";
import { ControlActionStatus, ControlBack, ControlConfirmation, ControlDocumentGate, ControlField, ControlHeading, ControlNotice } from "./control-ui";
export function ControlAction({ tab, id, mode, returnTo }: {
  tab: ControlTab;
  id: string;
  mode: string;
  returnTo: string;
}) {
  const vm = useControlAction(tab, id, mode, returnTo),
    title = mode === "retry" ? "Review due-occurrence attempt" : mode === "configure" ? "Configure Auto Post" : mode === "status" ? "Change schedule availability" : mode === "close" ? "Close accounting period" : "Reopen accounting period";
  return <div className="ct-workspace ct-editor">


    <ControlBack
      onClick={vm.cancel}
      disabled={vm.action.busy}
      label="Back to record"
      context="Explicit control action" />


    <ControlHeading eyebrow="Controls / Review action" title={title} description={vm.record?.name} />


    <ControlActionStatus action={vm.action}>


      <a href={vm.backHref} target="_blank" rel="noopener noreferrer" className="aa-secondary">Inspect register in another tab</a>


    </ControlActionStatus>


    {vm.action.phase === "idle" || vm.action.phase === "saving" ? <ControlDocumentGate vm={vm}>


      <form onSubmit={e => { e.preventDefault(); vm.review(); }} className="ct-section">


        {!vm.canManage ? <ControlNotice>finance.manage is required. This record is read-only for your role.</ControlNotice> : !vm.allowed ? <ControlNotice>This action is not available for the current record state. Return to the record to inspect its latest status.</ControlNotice> : <>


          <p className="ct-lead">


            {mode === "retry" ? "One due occurrence, using the current server schedule. The reviewed due date must still match; amount and account values are not frozen by that check." : mode === "configure" ? "Automatic posting configuration is separate from a manual post. Existing expenses are not changed." : mode === "status" ? "Pause or resume availability. No expense is created, reversed or deleted here." : "Check the inclusive dates and explain the accounting-control change before confirming."}


          </p>


          {tab === "periods" ? <ControlField
            label={mode === "reopen" ? "Reopen reason" : "Closing notes (optional)"}
            hint={mode === "reopen" ? "5–2,000 characters; retained in the audit trail." : "Leave blank or describe the closing review."}>


            <textarea
              value={vm.note}
              onChange={e => vm.change(e.target.value)}
              minLength={mode === "reopen" ? 5 : undefined}
              maxLength={mode === "reopen" ? 2000 : undefined}
              required={mode === "reopen"}
              disabled={vm.action.locked} />


          </ControlField> : null}


          {vm.error ? <ControlNotice tone="error">


            {vm.error}


          </ControlNotice> : null}


          <div className="ct-form-actions">


            <button type="button" className="aa-secondary" onClick={vm.cancel} disabled={vm.action.busy}>Cancel</button>


            <button className="aa-primary" disabled={!vm.allowed || vm.action.locked}>Review change</button>


          </div>


        </>}


      </form>


    </ControlDocumentGate> : null}


    <ControlConfirmation action={vm.action} />


  </div>;
}
