package lk.resq.localhub.service;

public interface CloudSyncGateway {

    CloudSyncClient.CloudSyncResult uploadSessionSummary(String payloadJson)
            throws CloudSyncClient.CloudSyncException;
}
