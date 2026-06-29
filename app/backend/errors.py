class PlatformError(Exception):
    """平台业务异常，message 面向中文用户。"""

    def __init__(self, message: str, *, provider_error: str = "", retry_advice: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.provider_error = provider_error
        self.retry_advice = retry_advice


class WorkflowValidationError(PlatformError):
    pass


class ComfyConnectionError(PlatformError):
    pass


class NotFoundError(PlatformError):
    pass
