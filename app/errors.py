"""共享异常与工具。"""


class Cancelled(Exception):
    """任务被用户取消。"""


class FriendlyError(Exception):
    """可以直接展示给用户的错误。"""

    def __init__(self, message: str, hint: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint
