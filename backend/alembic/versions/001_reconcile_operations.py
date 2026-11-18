"""create reconciliation and operation tables

Revision ID: 001_reconcile_operations
Revises: 
Create Date: 2026-11-02 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = '001_reconcile_operations'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # 1. operations table
    op.create_table(
        'operations',
        sa.Column('id', sa.CHAR(36), primary_key=True),
        sa.Column('type', sa.String(length=100), nullable=False),
        sa.Column('payload_json', sa.Text(), nullable=False),
        sa.Column('created_by', sa.CHAR(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('idempotency_key', sa.String(length=128), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='pending'),
        sa.Column('tenant_id', sa.CHAR(36), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True),
    )
    op.create_index('ix_operations_status', 'operations', ['status'])
    op.create_index('ix_operations_created_at', 'operations', ['created_at'])
    op.create_index('ix_operations_idempotency', 'operations', ['idempotency_key'])

    # 2. operation_targets table
    op.create_table(
        'operation_targets',
        sa.Column('id', sa.CHAR(36), primary_key=True),
        sa.Column('operation_id', sa.CHAR(36), sa.ForeignKey('operations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('target_host', sa.String(length=255), nullable=False),
        sa.Column('target_role', sa.String(length=50), nullable=False, server_default='node'),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='pending'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('last_attempt_at', sa.DateTime(), nullable=True),
        sa.Column('applied_at', sa.DateTime(), nullable=True),
        sa.Column('next_retry_at', sa.DateTime(), nullable=True),
        sa.Column('execution_log', sa.Text(), nullable=True),
    )
    op.create_index('ix_op_targets_op_id', 'operation_targets', ['operation_id'])
    op.create_index('ix_op_targets_host_status', 'operation_targets', ['target_host', 'status'])
    op.create_index('ix_op_targets_retry', 'operation_targets', ['status', 'next_retry_at'])

    # 3. target_health table
    op.create_table(
        'target_health',
        sa.Column('id', sa.CHAR(36), primary_key=True),
        sa.Column('host', sa.String(length=255), nullable=False),
        sa.Column('role', sa.String(length=50), nullable=False, server_default='node'),
        sa.Column('online', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('last_seen', sa.DateTime(), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_target_health_host', 'target_health', ['host'], unique=True)
    op.create_index('ix_target_health_online', 'target_health', ['online'])


def downgrade():
    op.drop_table('target_health')
    op.drop_table('operation_targets')
    op.drop_table('operations')
