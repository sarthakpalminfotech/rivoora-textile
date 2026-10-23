import { useParams } from 'react-router-dom';
import { ReceiptEntryPage } from './receipt-entry-page';

/** `/outside-pos/:id/receive` — receiving a weaver's challan against an outside PO. */
export default function OutsidePoReceivePage() {
  const id = Number(useParams().id);
  return <ReceiptEntryPage kind="outside_po" id={id} />;
}
