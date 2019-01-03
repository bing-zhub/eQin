package com.espressif.iot.esptouch;

import java.util.List;

public interface IEsptouchTask {
    String ESPTOUCH_VERSION = "v0.3.6.2";

    void setEsptouchListener(IEsptouchListener esptouchListener);

    void interrupt();

    IEsptouchResult executeForResult() throws RuntimeException;


    List<IEsptouchResult> executeForResults(int expectTaskResultCount) throws RuntimeException;

    boolean isCancelled();
}
