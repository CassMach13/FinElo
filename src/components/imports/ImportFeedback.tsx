import React from 'react';
import '../appearance/financial.css';

interface ImportFeedbackProps {
  visible: boolean;
  notification: {
    type: 'success' | 'error';
    message: string;
    summary?: {imported: number; ignored: number};
  } | null;
}

/** Display an existing result; parsing, validation and persistence remain in the importer. */
const ImportFeedback: React.FC<ImportFeedbackProps> = ({visible,notification}) => {
  if(!visible || !notification || (notification.type==='success' && notification.summary && notification.summary.imported>0))return null;
  const success=notification.type==='success';
  return <div data-finance-feedback role={success?'status':'alert'} aria-live={success?'polite':'assertive'}
    data-finance={success?'success-panel':'danger-chip'}
    className={`no-print p-3 rounded-lg text-sm text-center ${success?'bg-green-800/50 text-green-200 border border-green-700':'bg-red-800/50 text-red-200 border border-red-700'}`}>
    {notification.message}
  </div>;
};
export default ImportFeedback;
