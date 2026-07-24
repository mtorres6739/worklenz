import {
  Button,
  Card,
  Empty,
  Flex,
  Popconfirm,
  Spin,
  theme,
  Typography,
  Upload,
} from '@/shared/antd-imports';
import {
  DeleteOutlined,
  DownloadOutlined,
  InboxOutlined,
  PaperClipOutlined,
} from '@ant-design/icons';

export interface RequestAttachmentItem {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  sender_type: 'client' | 'staff';
  created_at: string;
  can_delete?: boolean;
}

interface Props {
  attachments: RequestAttachmentItem[];
  loading?: boolean;
  canUpload?: boolean;
  uploading?: boolean;
  onUpload?: (file: File) => Promise<void>;
  onDownload: (attachment: RequestAttachmentItem) => Promise<void>;
  onDelete?: (attachment: RequestAttachmentItem) => Promise<void>;
  canDelete?: (attachment: RequestAttachmentItem) => boolean;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const RequestAttachmentsCard = ({
  attachments,
  loading,
  canUpload,
  uploading,
  onUpload,
  onDownload,
  onDelete,
  canDelete = () => true,
}: Props) => {
  const { token } = theme.useToken();
  return (
    <Card title="Secure attachments">
      <Flex vertical gap={16}>
        {canUpload && onUpload && (
          <Upload.Dragger
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
            multiple={false}
            showUploadList={false}
            disabled={uploading}
            beforeUpload={async file => {
              await onUpload(file as File);
              return Upload.LIST_IGNORE;
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <Typography.Text strong>
              {uploading ? 'Scanning and uploading…' : 'Drop one file here or click to browse'}
            </Typography.Text>
            <br />
            <Typography.Text type="secondary">
              Up to 20 MB. PDF, Office, text, CSV, and common image formats.
            </Typography.Text>
          </Upload.Dragger>
        )}

        {loading ? (
          <Spin />
        ) : attachments.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No attachments yet." />
        ) : (
          <Flex vertical gap={8}>
            {attachments.map(attachment => (
              <Flex
                key={attachment.id}
                align="center"
                justify="space-between"
                gap={12}
                style={{
                  padding: '10px 12px',
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 8,
                }}
              >
                <Flex align="center" gap={10} style={{ minWidth: 0 }}>
                  <PaperClipOutlined />
                  <div style={{ minWidth: 0 }}>
                    <Typography.Text ellipsis style={{ display: 'block', maxWidth: 520 }}>
                      {attachment.name}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {fileSize(Number(attachment.size) || 0)} · {attachment.sender_type}
                    </Typography.Text>
                  </div>
                </Flex>
                <Flex gap={6}>
                  <Button
                    type="text"
                    aria-label={`Download ${attachment.name}`}
                    icon={<DownloadOutlined />}
                    onClick={() => void onDownload(attachment)}
                  />
                  {onDelete && canDelete(attachment) && (
                    <Popconfirm
                      title="Delete this attachment?"
                      okText="Delete"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => onDelete(attachment)}
                    >
                      <Button
                        danger
                        type="text"
                        aria-label={`Delete ${attachment.name}`}
                        icon={<DeleteOutlined />}
                      />
                    </Popconfirm>
                  )}
                </Flex>
              </Flex>
            ))}
          </Flex>
        )}
      </Flex>
    </Card>
  );
};

export default RequestAttachmentsCard;
