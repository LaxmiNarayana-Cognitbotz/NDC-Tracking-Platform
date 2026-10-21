from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, func
from config.database import Base


class EmailDepartmentConfig(Base):
    __tablename__ = "email_department_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    department = Column(String(100), unique=True, nullable=False, index=True)
    is_enabled = Column(Boolean, default=True, nullable=False)
    cc_recipients = Column(Text, nullable=True)  # Comma-separated CC emails
    scheduled_time = Column(String(50), nullable=True, default="10:00")
    notification_types = Column(Text, nullable=True)  # Comma-separated: daily_summary,tomorrow_alert,delayed_reminder
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

