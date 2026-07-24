import {
  Alert,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Select,
  Spin,
  Typography,
  message,
} from '@/shared/antd-imports';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useCreateRequestMutation,
  useGetServicesQuery,
} from '@/api/client-portal/portal-client.api';

const NewRequestForm = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();
  const { data, isLoading, error } = useGetServicesQuery();
  const [createRequest, { isLoading: isSubmitting }] = useCreateRequestMutation();
  const selectedServiceId = Form.useWatch('service_id', form);
  const services = data?.services || [];
  const selectedService = useMemo(
    () => services.find(service => service.id === selectedServiceId),
    [selectedServiceId, services]
  );
  const questions = selectedService?.service_data?.request_form || [];

  if (isLoading) return <Spin size="large" />;
  if (error) return <Alert type="error" showIcon message="Services could not be loaded" />;

  return (
    <Flex vertical gap={20} style={{ width: '100%', maxWidth: 860 }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          New request
        </Typography.Title>
        <Typography.Text type="secondary">
          Give the SDM team the information needed to start work.
        </Typography.Text>
      </div>
      <Card>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            service_id: searchParams.get('serviceId') || undefined,
            priority: 'medium',
          }}
          onFinish={async values => {
            const questionAnswers = questions.map((question, index) => ({
              question: question.question,
              type: question.type,
              answer: values.answers?.[index] ?? null,
            }));
            try {
              const created = await createRequest({
                service_id: values.service_id,
                notes: values.notes,
                request_data: {
                  title: values.title,
                  description: values.description,
                  priority: values.priority,
                  questionAnswers,
                },
              }).unwrap();
              message.success('Request submitted');
              navigate(`/client-portal/requests/${created.id}`, { replace: true });
            } catch {
              message.error('The request could not be submitted. Please try again.');
            }
          }}
        >
          <Form.Item
            name="service_id"
            label="Service"
            rules={[{ required: true, message: 'Select a service' }]}
          >
            <Select
              placeholder="Select a service"
              options={services.map(service => ({ label: service.name, value: service.id }))}
            />
          </Form.Item>
          <Form.Item
            name="title"
            label="Request title"
            rules={[{ required: true, message: 'Enter a request title' }]}
          >
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item
            name="description"
            label="Description"
            rules={[{ required: true, message: 'Describe what you need' }]}
          >
            <Input.TextArea rows={5} maxLength={5000} showCount />
          </Form.Item>
          <Form.Item name="priority" label="Priority">
            <Select
              options={['low', 'medium', 'high', 'urgent'].map(value => ({
                label: value[0].toUpperCase() + value.slice(1),
                value,
              }))}
            />
          </Form.Item>
          {questions.map((question, index) => (
            <Form.Item
              key={`${question.question}-${index}`}
              name={['answers', index]}
              label={question.question}
              rules={
                question.required && question.type !== 'attachment'
                  ? [{ required: true, message: 'This field is required' }]
                  : undefined
              }
            >
              {question.type === 'multipleChoice' ? (
                <Select options={(question.answer || []).map(value => ({ label: value, value }))} />
              ) : question.type === 'attachment' ? (
                <Alert
                  type="info"
                  showIcon
                  message="Secure request attachments are not enabled yet. Add a note and your project manager will provide an upload link."
                />
              ) : (
                <Input.TextArea rows={3} maxLength={3000} />
              )}
            </Form.Item>
          ))}
          <Form.Item name="notes" label="Additional notes">
            <Input.TextArea rows={3} maxLength={3000} />
          </Form.Item>
          <Flex gap={12}>
            <Button type="primary" htmlType="submit" loading={isSubmitting}>
              Submit request
            </Button>
            <Button onClick={() => navigate('/client-portal/requests')}>Cancel</Button>
          </Flex>
        </Form>
      </Card>
    </Flex>
  );
};

export default NewRequestForm;
