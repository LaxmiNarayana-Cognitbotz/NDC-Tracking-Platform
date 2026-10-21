from sqlalchemy import Column, DateTime, Float, Index, Integer, String, Text, func
from config.database import Base


class AutomationEmailLog(Base):
    __tablename__ = "automation_email_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category = Column(String(50), nullable=False)  # AUTOMATION, EMAIL, SYNC
    action_type = Column(String(100), nullable=False)
    department = Column(String(100), nullable=True)
    target_recipient = Column(String(255), nullable=True)
    cc_recipients = Column(Text, nullable=True)
    admin_recipients = Column(Text, nullable=True)
    status = Column(String(50), nullable=False, default="SUCCESS")  # SUCCESS, FAILED, RUNNING, WARNING
    details = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    duration_seconds = Column(Float, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_auto_email_logs_cat_status", "category", "status"),
        Index("idx_auto_email_logs_created_at", "created_at"),
    )

