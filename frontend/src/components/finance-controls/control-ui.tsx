"use client";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { ControlDocumentState } from "@/hooks/use-control-document";
export { AccountHeading as ControlHeading, AccountSectionHeading as ControlSectionHeading, AccountState as ControlState } from "@/components/accounting-accounts/account-ui";
export { AdvancedField as ControlField, AdvancedDatum as ControlDatum, AdvancedNotice as ControlNotice, AdvancedPager as ControlPager, AdvancedConfirmation as ControlConfirmation } from "@/components/accounting-advanced/advanced-ui";
import { AdvancedActionStatus, type AdvancedActionPresentation } from "@/components/accounting-advanced/advanced-ui";
import { AccountState } from "@/components/accounting-accounts/account-ui";
export function ControlBack({ href, onClick, disabled = false, label = "Back to controls", context }: {
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  label?: string;
  context: string;
}) {
  return <div className="ct-breadcrumb">

    {href ? <a href={href} className="aa-back">

      <ArrowLeft aria-hidden="true" />

      {label}

    </a> : <button type="button" className="aa-back" disabled={disabled} onClick={onClick}>

      <ArrowLeft aria-hidden="true" />

      {label}

    </button>}

    <span>

      {context}

    </span>

  </div>;
}
export function ControlTag({ children, tone = "neutral" }: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn";
}) {
  return <span className="ct-tag" data-tone={tone}>

    {children}

  </span>;
}
export function ControlDocumentGate({ vm, children }: {
  vm: ControlDocumentState;
  children: ReactNode;
}) {
  if (!vm.canView)
    return <AccountState title="Finance read access required">This workspace requires finance.view. Management permission does not grant read access.</AccountState>;
  if (vm.invalidId)
    return <AccountState title="Invalid control link">Return to the register and choose a saved record.</AccountState>;
  if (vm.resource.loading)
    return <AccountState title="Loading current record" loading />;
  if (vm.resource.error)
    return <AccountState
      title="Current record unavailable"
      action={<button type="button" className="aa-secondary" onClick={vm.refresh}>Retry read</button>}>

      {vm.resource.error}

    </AccountState>;
  if (!vm.record)
    return <AccountState title="Record not found in this company">No record with this exact identity was returned. No replacement record is selected.</AccountState>;
  return <>

    {children}

  </>;
}
export function ControlActionStatus({ action, children }: {
  action: AdvancedActionPresentation;
  children?: ReactNode;
}) {
  return <AdvancedActionStatus action={action}>

    {action.operation ? <div className="ct-retained-warning">

      <p>

        {action.operation.description}

      </p>

      <p>

        <strong>Reviewed warning: </strong>

        {action.operation.warning}

      </p>

    </div> : null}

    {children}

  </AdvancedActionStatus>;
}
