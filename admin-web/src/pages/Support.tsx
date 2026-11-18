import { ChatIcon } from '../components/icons';
import { PageHeader } from '../components/ui';
import GuestSupportRequests from '../components/GuestSupportRequests';

export default function Support() {
  return (
    <div>
      <PageHeader
        title="Support"
        subtitle="Consultez et traitez les demandes envoyées au centre d’aide."
        icon={<ChatIcon className="h-6 w-6" />}
      />
      <GuestSupportRequests />
    </div>
  );
}
